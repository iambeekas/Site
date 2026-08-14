/**
 * build-posts.js
 * ----------------------------------------------------------------
 * Fetches every blog post from Contentful (content type: myPersonalBlog)
 * and pre-renders each one into its own real, static HTML file under
 * /posts/<slug>.html — with a unique <title>, meta description, and the
 * full article content already baked into the HTML.
 *
 * WHY THIS EXISTS:
 * The site previously rendered every blog post through a single shared
 * page (post.html?id=X) that fetched content client-side via JavaScript.
 * That page's static HTML was nearly empty ("Loading article…") and
 * identical for every post — which Google AdSense flagged as both
 * "replicated content" and "low value content" during review. This
 * script fixes that at the root: every post now gets its own genuinely
 * unique, crawlable static page.
 *
 * Run with: node build-posts.js
 * (Wired up as the Cloudflare Pages build command via package.json)
 * ----------------------------------------------------------------
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SPACE_ID = 'd1c7q2jyz0do';
const ACCESS_TOKEN = 'ULXUDAh4jQrf6fLuHPr9ec2G_K4fHk23gV3K8LEr-yk';
const CONTENT_TYPE = 'myPersonalBlog';
const SITE_URL = 'https://bikasb.com.np';
const OUTPUT_DIR = path.join(__dirname, 'posts');
const SITEMAP_PATH = path.join(__dirname, 'sitemap.xml');
const BLOG_HTML_PATH = path.join(__dirname, 'blog.html');

// ---------------------------------------------------------------
// 1. Fetch all entries from Contentful (handles pagination)
// ---------------------------------------------------------------
function fetchAllEntries() {
  return new Promise((resolve, reject) => {
    const results = [];

    function fetchPage(skip) {
      const url = `https://cdn.contentful.com/spaces/${SPACE_ID}/environments/master/entries` +
        `?content_type=${CONTENT_TYPE}&order=-sys.createdAt&limit=100&skip=${skip}` +
        `&access_token=${ACCESS_TOKEN}`;

      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Contentful API returned ${res.statusCode}: ${data}`));
          }
          try {
            const json = JSON.parse(data);
            results.push(...(json.items || []));
            const total = json.total || 0;
            const fetchedSoFar = skip + (json.items || []).length;
            if (fetchedSoFar < total) {
              fetchPage(fetchedSoFar);
            } else {
              resolve(results);
            }
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject);
    }

    fetchPage(0);
  });
}

// ---------------------------------------------------------------
// 2. Rich Text -> HTML (ported 1:1 from js/contentful-blog.js so
//    both the client-side and build-time renderers stay identical)
// ---------------------------------------------------------------
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeToHtml(node) {
  if (!node) return '';
  switch (node.nodeType) {
    case 'paragraph':
      return '<p>' + (node.content || []).map(nodeToHtml).join('') + '</p>';
    case 'heading-1':
      return '<h1>' + (node.content || []).map(nodeToHtml).join('') + '</h1>';
    case 'heading-2':
      return '<h2>' + (node.content || []).map(nodeToHtml).join('') + '</h2>';
    case 'heading-3':
      return '<h3>' + (node.content || []).map(nodeToHtml).join('') + '</h3>';
    case 'unordered-list':
      return '<ul>' + (node.content || []).map(nodeToHtml).join('') + '</ul>';
    case 'ordered-list':
      return '<ol>' + (node.content || []).map(nodeToHtml).join('') + '</ol>';
    case 'list-item':
      return '<li>' + (node.content || []).map(nodeToHtml).join('') + '</li>';
    case 'blockquote':
      return '<blockquote>' + (node.content || []).map(nodeToHtml).join('') + '</blockquote>';
    case 'hr':
      return '<hr/>';
    case 'text': {
      let t = escapeHtml(node.value || '');
      (node.marks || []).forEach((m) => {
        if (m.type === 'bold') t = '<strong>' + t + '</strong>';
        if (m.type === 'italic') t = '<em>' + t + '</em>';
        if (m.type === 'underline') t = '<u>' + t + '</u>';
        if (m.type === 'code') t = '<code>' + t + '</code>';
      });
      return t;
    }
    case 'hyperlink':
      return '<a href="' + escapeHtml((node.data && node.data.uri) || '#') + '" target="_blank" rel="noopener">' +
        (node.content || []).map(nodeToHtml).join('') + '</a>';
    default:
      return (node.content || []).map(nodeToHtml).join('');
  }
}

function richTextToHtml(doc) {
  if (!doc || !doc.content) return '';
  return doc.content.map(nodeToHtml).join('');
}

function plainTextFromRichText(doc, maxLen) {
  function walk(n) {
    if (!n) return '';
    if (n.nodeType === 'text') return n.value || '';
    return (n.content || []).map(walk).join('');
  }
  const text = walk(doc).replace(/\s+/g, ' ').trim();
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen).trim() + '…';
  return text;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// ---------------------------------------------------------------
// 3. Normalize a Contentful entry into the fields we need
// ---------------------------------------------------------------
function normalizeEntry(item, usedSlugs) {
  const f = item.fields || {};
  const title = f.title || 'Untitled';
  const description = f.description || plainTextFromRichText(f.content, 160) || `Accounting article by Bikash Bhandari, ACCA.`;
  const category = f.category || 'Blog';

  let slug = f.slug ? slugify(f.slug) : slugify(title);
  if (!slug) slug = item.sys.id;
  // Guard against two posts producing the same slug
  if (usedSlugs.has(slug)) {
    slug = slug + '-' + item.sys.id.slice(0, 6);
  }
  usedSlugs.add(slug);

  return {
    id: item.sys.id,
    title,
    description,
    category,
    slug,
    date: formatDate(item.sys.createdAt),
    createdAt: item.sys.createdAt,
    contentHtml: richTextToHtml(f.content) || '<p></p>',
    url: `/posts/${slug}.html`
  };
}

// ---------------------------------------------------------------
// 4. Render a single post's static HTML page
// ---------------------------------------------------------------
function renderPostPage(post) {
  const safeTitle = escapeHtml(post.title);
  const safeDescription = escapeHtml(post.description);
  const safeCategory = escapeHtml(post.category);
  const canonical = `${SITE_URL}${post.url}`;

  return `<!DOCTYPE html>
<html lang="en-NP">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} | Bikash Bhandari ACCA</title>
  <meta name="description" content="${safeDescription}" />
  <meta name="author" content="Bikash Bhandari, ACCA" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Bikash Bhandari ACCA" />
  <meta property="og:title" content="${safeTitle} | Bikash Bhandari ACCA" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${SITE_URL}/profile.jpg" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${safeTitle} | Bikash Bhandari ACCA" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${SITE_URL}/profile.jpg" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(post.title)},
    "description": ${JSON.stringify(post.description)},
    "datePublished": "${post.createdAt}",
    "author": { "@type": "Person", "name": "Bikash Bhandari", "url": "${SITE_URL}/about.html" },
    "publisher": { "@type": "Person", "name": "Bikash Bhandari" },
    "mainEntityOfPage": "${canonical}",
    "image": "${SITE_URL}/profile.jpg"
  }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --acca-red: #E4002B; --acca-dark-gray: #251F20; --acca-cool-gray: #F4F5F7;
      --border-tint: #E2E8F0; --bg-color: #FFFFFF; --text-color: #251F20;
      --card-bg: #FFFFFF; --muted-text: #64748B;
    }
    [data-theme="dark"] {
      --bg-color: #0F1115; --text-color: #E2E8F0; --card-bg: #161A22;
      --border-tint: #374151; --muted-text: #94A3B8; --acca-dark-gray: #FFFFFF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', sans-serif; background: var(--bg-color); color: var(--text-color); line-height: 1.7; transition: background-color 0.3s, color 0.3s; }
    .navbar { position: sticky; top: 0; z-index: 1000; background: var(--card-bg) !important; border-bottom: 2px solid var(--acca-red); padding: 1rem 1.5rem; }
    .nav-container { max-width: 900px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center; }
    .nav-logo { font-weight: 700; font-size: 1.3rem; text-decoration: none; color: var(--text-color); }
    .nav-logo span { color: var(--acca-red); }
    .nav-links { display: flex; gap: 1.25rem; list-style: none; align-items: center; }
    .nav-links a { text-decoration: none; color: var(--text-color); font-weight: 500; font-size: 0.95rem; }
    .nav-links a:hover { color: var(--acca-red); }
    .theme-toggle-btn { background: none; border: 1px solid var(--border-tint); padding: 0.4rem 0.9rem; border-radius: 4px; cursor: pointer; color: var(--text-color); }
    .menu-toggle { display: none; }
    @media (max-width: 868px) {
      .menu-toggle { display: flex; flex-direction: column; justify-content: space-between; width: 24px; height: 18px; background: transparent; border: none; cursor: pointer; }
      .menu-toggle span { width: 100%; height: 3px; background: var(--text-color); border-radius: 2px; }
      .nav-links { display: none; position: absolute; top: 100%; left: 0; right: 0; background: var(--card-bg); flex-direction: column; padding: 1rem 0; border-bottom: 2px solid var(--border-tint); }
      .nav-links.active { display: flex; }
      .nav-links a { padding: 0.75rem 1.5rem; width: 100%; text-align: center; }
    }
    .post-wrap { max-width: 720px; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    .post-meta { font-size: 0.9rem; color: var(--muted-text); margin-bottom: 0.75rem; }
    .post-meta .badge { display: inline-block; background: rgba(228,0,43,0.08); color: var(--acca-red); padding: 0.25rem 0.7rem; border-radius: 4px; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 0.5rem; }
    .post-title { font-size: 2.2rem; font-weight: 700; line-height: 1.2; margin-bottom: 1.5rem; border-left: 4px solid var(--acca-red); padding-left: 1rem; }
    .post-body { font-size: 1.05rem; }
    .post-body p { margin-bottom: 1.15rem; }
    .post-body h2 { font-size: 1.45rem; margin: 2rem 0 0.75rem; }
    .post-body h3 { font-size: 1.2rem; margin: 1.5rem 0 0.5rem; }
    .post-body ul, .post-body ol { margin: 0 0 1.15rem 1.4rem; }
    .post-body li { margin-bottom: 0.4rem; }
    .post-body a { color: var(--acca-red); }
    .post-body blockquote { border-left: 3px solid var(--acca-red); padding-left: 1rem; margin: 1.5rem 0; color: var(--muted-text); font-style: italic; }
    .back-link { display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 2.5rem; padding: 0.65rem 1.15rem; color: var(--acca-red); font-weight: 600; text-decoration: none; border: 1.5px solid var(--acca-red); border-radius: 6px; background: transparent; transition: background 0.2s, color 0.2s; }
    .back-link:hover { background: var(--acca-red); color: #FFFFFF; }
    [data-theme="dark"] .back-link { color: #ff6b81; border-color: #ff6b81; }
    [data-theme="dark"] .back-link:hover { background: #ff6b81; color: #0F1115; }
    .footer { background: var(--acca-dark-gray, #0d0f12); color: #94A3B8; padding: 2rem 1.5rem; text-align: center; font-size: 0.85rem; border-top: 1px solid var(--border-tint); }
    [data-theme="dark"] .footer { background: #0a0c10; border-top-color: #374151; }
    .footer a { color: #94A3B8; text-decoration: none; }
    .footer a:hover { color: #E4002B; }
  </style>
</head>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <a href="/index.html" class="nav-logo">BIKASH ACCA<span>.</span></a>
      <button class="menu-toggle" id="mobile-menu-btn" aria-label="Toggle Navigation" onclick="toggleMobileMenu()">
        <span></span><span></span><span></span>
      </button>
      <ul class="nav-links" id="nav-menu-links">
        <li><a href="/index.html">Home</a></li>
        <li><a href="/about.html">About Profile</a></li>
        <li><a href="/Resources.html">Resources</a></li>
        <li><a href="/blog.html">Blog</a></li>
        <li><a href="/contact.html">Contact</a></li>
        <li><button class="theme-toggle-btn" id="theme-toggle" onclick="toggleTheme()">🌙 Dark Mode</button></li>
      </ul>
    </div>
  </nav>

  <main class="post-wrap">
    <div class="post-meta">
      <span class="badge">${safeCategory}</span>${post.date || ''}
    </div>
    <h1 class="post-title">${safeTitle}</h1>
    <div class="post-body">${post.contentHtml}</div>
    <a class="back-link" href="/blog.html">← Back to Blog</a>
  </main>

  <footer class="footer">
    <p>&copy; 2026 Bikash Bhandari. All rights reserved.</p>
  </footer>

  <script>
    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('saved-theme', next);
      const btn = document.getElementById('theme-toggle');
      if (btn) btn.innerText = next === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
    }
    function toggleMobileMenu() {
      document.getElementById('mobile-menu-btn').classList.toggle('open');
      document.getElementById('nav-menu-links').classList.toggle('active');
    }
    (function() {
      const saved = localStorage.getItem('saved-theme') || 'light';
      document.documentElement.setAttribute('data-theme', saved);
      const btn = document.getElementById('theme-toggle');
      if (btn) btn.innerText = saved === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
    })();
  </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------
// 5. Build a static, crawlable post-card list to inject into blog.html
// ---------------------------------------------------------------
function renderPostCard(post) {
  const safeTitle = escapeHtml(post.title);
  const safeDescription = escapeHtml(post.description);
  const safeCategory = escapeHtml(post.category);
  return `                <article class="post">
                    <div class="meta">${post.date || ''} &middot; ${safeCategory}</div>
                    <h2>${safeTitle}</h2>
                    <p>${safeDescription}</p>
                    <a href="${post.url}" class="read-link">Read the Post</a>
                </article>`;
}

function injectIntoBlogHtml(posts) {
  if (!fs.existsSync(BLOG_HTML_PATH)) {
    console.warn('blog.html not found — skipping post-list injection.');
    return;
  }
  let html = fs.readFileSync(BLOG_HTML_PATH, 'utf8');
  const startMarker = '<!-- POSTS_LIST_START -->';
  const endMarker = '<!-- POSTS_LIST_END -->';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.warn('POSTS_LIST_START/END markers not found in blog.html — skipping injection. Add these markers around the post list to enable this.');
    return;
  }

  const cardsHtml = posts.map(renderPostCard).join('\n\n');
  const newHtml = html.slice(0, startIdx + startMarker.length) +
    '\n' + cardsHtml + '\n                ' +
    html.slice(endIdx);

  fs.writeFileSync(BLOG_HTML_PATH, newHtml, 'utf8');
  console.log(`Injected ${posts.length} post cards into blog.html`);
}

// ---------------------------------------------------------------
// 6. Update sitemap.xml with all post URLs
// ---------------------------------------------------------------
function updateSitemap(posts) {
  if (!fs.existsSync(SITEMAP_PATH)) {
    console.warn('sitemap.xml not found — skipping sitemap update.');
    return;
  }
  let xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const startMarker = '<!-- POSTS_SITEMAP_START -->';
  const endMarker = '<!-- POSTS_SITEMAP_END -->';
  const startIdx = xml.indexOf(startMarker);
  const endIdx = xml.indexOf(endMarker);

  const entries = posts.map((p) => `  <url>
    <loc>${SITE_URL}${p.url}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

  if (startIdx === -1 || endIdx === -1) {
    const closeTag = '</urlset>';
    if (!xml.includes(closeTag)) {
      console.warn('sitemap.xml has no </urlset> — skipping sitemap update.');
      return;
    }
    xml = xml.replace(closeTag, `${startMarker}\n${entries}\n${endMarker}\n${closeTag}`);
  } else {
    xml = xml.slice(0, startIdx + startMarker.length) +
      '\n' + entries + '\n' +
      xml.slice(endIdx);
  }

  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
  console.log(`Updated sitemap.xml with ${posts.length} post URLs`);
}

// ---------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------
async function main() {
  console.log('Fetching posts from Contentful...');
  const rawEntries = await fetchAllEntries();
  console.log(`Fetched ${rawEntries.length} entries.`);

  const usedSlugs = new Set();
  const posts = rawEntries.map((item) => normalizeEntry(item, usedSlugs));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  posts.forEach((post) => {
    const filePath = path.join(OUTPUT_DIR, `${post.slug}.html`);
    fs.writeFileSync(filePath, renderPostPage(post), 'utf8');
    console.log(`Wrote posts/${post.slug}.html`);
  });

  injectIntoBlogHtml(posts);
  updateSitemap(posts);

  console.log(`\nDone. ${posts.length} static post pages generated under /posts/.`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
