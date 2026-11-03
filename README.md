# Site
bikasb.com.np

## Deploy
Cloudflare build command: `npm run build` (runs `node build-posts.js`).
It fetches posts from Contentful, writes `posts/<slug>.html`, and refreshes the post lists in
`blog.html`, `index.html` (homepage cards) and `sitemap.xml`. Commit nothing from `posts/`; it is generated on deploy.
