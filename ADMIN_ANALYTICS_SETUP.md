# BikasB admin analytics dashboard (PR #31)

## What this adds
- A responsive reporting page at `/admin-analytics.html`.
- Aggregate reporting from the existing `daily_tool_metrics` D1 table.
- Summary totals, daily page views/completions/failures, tool activity, device breakdown, file-size categories and average completed processing duration.
- Date filtering for up to 366 days and CSV export.
- A read-only `GET /api/admin/analytics` endpoint. It returns aggregate data only; no visitor-level records or document information are queried.
- Cloudflare Access JWT verification in the Worker. The page itself is only a static shell; the data API independently verifies the Access JWT on every request.

## Required Cloudflare Access configuration before using the dashboard

Do not treat the dashboard URL as secret. Protect both paths with Cloudflare Access.

1. In Cloudflare Zero Trust, open **Access → Applications** and add a **Self-hosted** application for the hostname `bikasb.com.np`.
2. Configure path protection for **both**:
   - `/admin-analytics.html`
   - `/api/admin/analytics`
   If the dashboard UI asks for separate path-specific applications, create two applications with the same hostname and their respective paths. Both must use an Allow policy restricted to your own verified email address (or a tightly controlled admin identity group). Do not use an Everyone policy.
3. Save the application(s). Copy the Access **AUD tag** for the application protecting `/api/admin/analytics`. The JWT presented to the API must have this audience.
4. In **Workers & Pages → site → Settings → Variables and Secrets**, add these Worker environment variables:
   - `CF_ACCESS_TEAM_DOMAIN`: your Cloudflare Zero Trust team domain, e.g. `your-team.cloudflareaccess.com` (domain only; no scheme or path).
   - `CF_ACCESS_AUD`: the Access application AUD tag for the API path.
5. Save and deploy the Worker after adding the variables. Keep the Access application enabled. No API token or account global key is required by this dashboard code.

The Worker validates the JWT signature against the Cloudflare Access signing keys and checks issuer, audience, expiry and not-before time. If either variable is missing or the JWT is invalid, the endpoint denies access. The Access policy is responsible for restricting which email identities can obtain a valid JWT.

## Verify after deployment
1. Open `https://bikasb.com.np/admin-analytics.html` in a browser signed in through Cloudflare Access.
2. Confirm the date range loads and totals appear.
3. Try a date range with no events; the page should show zero totals and empty charts/tables.
4. Export CSV and confirm the selected date range is in the filename.
5. Open `https://bikasb.com.np/api/admin/analytics` in a private browser session that is not authenticated through Access. It must not return analytics data. Depending on Access policy, the request may be redirected to Access login or return an authentication error.
6. Confirm the API response is not cached. It sends `Cache-Control: no-store`.

## Data interpretation
- Counts include only events from visitors who explicitly opted into optional analytics.
- Page views and tool selections are separate events; they should not be added together as unique visitors.
- Completion rate is completed ÷ (completed + failed). It is not a user-level conversion rate.
- Average processing time uses the duration totals recorded for completed processing events.
- Device and file-size breakdowns count completed processing events only.
- The existing schema is daily aggregate data. This dashboard does not create or retain raw events, IP addresses, visitor IDs, session IDs, file names, exact file sizes or document contents.

## Operational notes
- The endpoint accepts GET only and caps requested date ranges at 366 days.
- Dashboard access is intentionally unavailable until Cloudflare Access and both Worker variables are configured.
- If Access is configured for the page but not the API path, the API remains protected by its own JWT verification and will return 401.
