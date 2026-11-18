# BikasB admin analytics dashboard (PR #31)

## What this adds
- A private dashboard at `/admin/` with a password sign-in screen.
- Aggregate reporting from the existing `daily_tool_metrics` D1 table.
- Summary totals, daily activity, tool usage, device and file-size breakdowns, date filtering (up to 366 days), and CSV export.
- A read-only `GET /admin/api/analytics` endpoint. It returns aggregate data only; no visitor-level records or document information are queried.
- Password verification and signed, eight-hour sessions in the Worker. The session cookie is Secure, HttpOnly, SameSite=Strict and scoped to `/admin`.

## Required Worker secrets

This version does **not** require Cloudflare Access, a paid plan, payment details, an API token, or banking information.

In **Cloudflare Dashboard → Workers & Pages → site → Settings → Variables and Secrets**, add these as **Secrets** (not plain text variables):

1. `ADMIN_PASSWORD`: choose a long, unique password of at least 16 characters. Prefer a password-manager-generated password.
2. `ADMIN_SESSION_SECRET`: generate a separate random secret of at least 32 characters. Do not reuse the admin password.

Save the secrets and deploy the Worker. Do not put either secret in GitHub, source code, a public page, or a chat message. Choose the **Secret** type for both values.

## Verify after deployment
1. Visit `https://bikasb.com.np/admin/`.
2. Sign in using the `ADMIN_PASSWORD` secret.
3. Confirm the date range loads and totals appear.
4. Try a date range with no events; it should show zero totals and empty charts/tables.
5. Export CSV and confirm the selected date range is in the filename.
6. Open `https://bikasb.com.np/admin/api/analytics` in a private browser session without an admin session. It must return an authentication error, not analytics data.
7. Admin sessions expire after eight hours. Rotating `ADMIN_SESSION_SECRET` invalidates existing sessions.

## Security notes
- The dashboard HTML is only a sign-in shell; analytics data is not embedded in it.
- The Worker verifies the password server-side and signs session cookies with HMAC-SHA-256.
- Login requests require the exact site Origin. The cookie is HttpOnly, Secure, SameSite=Strict and scoped to `/admin`.
- Use a long, unique password. Consider adding Cloudflare edge rate limiting as an additional layer if available; do not rely on a short or reused password.
- Keep both secrets private. Rotating the session secret invalidates existing sessions.

## Data interpretation
- Counts include only events from visitors who explicitly opted into optional analytics.
- Page views and tool selections are separate events; they should not be added together as unique visitors.
- Completion rate is completed ÷ (completed + failed). It is not a user-level conversion rate.
- Average processing time uses duration totals recorded for completed processing events.
- Device and file-size breakdowns count completed processing events only.
- The existing schema is daily aggregate data. This dashboard does not create or retain raw events, IP addresses, visitor IDs, session IDs, file names, exact file sizes or document contents.

## Operational notes
- The analytics endpoint accepts GET only and caps requested date ranges at 366 days.
- If either required Worker secret is missing, login is unavailable and analytics requests remain denied.