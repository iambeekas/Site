# BikasB analytics setup (PR #29)

## What this adds
- Optional first-party analytics on `tools.html`, enabled only after an affirmative choice.
- Daily aggregate D1 metrics for page views, tool selection, processing starts, completions and failures.
- Broad device categories, coarse combined file-size buckets, and processing duration totals.
- No visitor/session IDs, analytics cookies, filenames, document contents, extracted text, exact file sizes, or IP addresses in the analytics database.
- The existing Worker continues to serve static assets and handle the legacy `/post.html` redirect.

## Cloudflare setup
1. Create the D1 database named `bikasb-analytics` in the Cloudflare account serving this site.
2. Confirm the database ID in `wrangler.toml` matches the database shown in Cloudflare.
3. Apply the migration to the remote database:
   ```sh
   npx wrangler d1 migrations apply bikasb-analytics --remote
   ```
4. Deploy the Worker with the updated `wrangler.toml` and `worker.js`. If deployment is connected to GitHub, merge the PR after review to trigger the configured deployment pipeline.
5. Visit `https://bikasb.com.np/tools.html`, choose “Allow optional analytics”, and use a tool. Check the D1 table `daily_tool_metrics` for today's aggregate rows.

## Safe verification
- Declining analytics should result in no browser request to `/api/analytics`.
- Accepting should send a same-origin JSON POST to `/api/analytics`.
- The endpoint rejects other origins, methods, content types, malformed events, unknown tool IDs, and oversized batches.
- The endpoint accepts at most 20 events per request and 8 KB per request.
- If analytics is unavailable, PDF processing remains usable; the browser ignores analytics network errors.

## Important deployment note
The migration must be applied to the remote D1 database before the deployed endpoint can write successfully. The endpoint returns a service-unavailable response if the D1 binding or table is unavailable. Analytics is optional and must never block document processing.
