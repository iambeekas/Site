/* Universal first-party site search with Google fallback */
(() => {
  "use strict";
  const INDEX_URL = "/search-index.json";
  let indexPromise;
  const $ = (id) => document.getElementById(id);
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  }
  function loadIndex() {
    if (!indexPromise) indexPromise = fetch(INDEX_URL, { credentials: "same-origin" }).then(response => {
      if (!response.ok) throw new Error("Search index unavailable");
      return response.json();
    }).then(items => Array.isArray(items) ? items : []).catch(() => []);
    return indexPromise;
  }
  function ensureModal() {
    if ($("site-search-overlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "site-search-overlay";
    overlay.id = "site-search-overlay";
    overlay.innerHTML = '<section class="site-search-panel" role="dialog" aria-modal="true" aria-label="Search this website"><div class="site-search-input-row">'+icon+'<input type="search" id="site-search-input" placeholder="Search pages, articles, study materials and tools…" autocomplete="off" aria-label="Search this website"><button type="button" class="site-search-close" id="site-search-close" aria-label="Close search">×</button></div><div id="site-search-results" class="site-search-results" aria-live="polite"></div><div class="site-search-hint">Press Esc to close · Search this website first, then Google if no match is found</div></section>';
    document.body.appendChild(overlay);
  }
  function addSearchButton() {
    const list = document.querySelector(".nav-links");
    if (!list || $("site-search-toggle")) return;
    const item = document.createElement("li");
    item.className = "site-search-toggle-item";
    item.innerHTML = '<button type="button" class="site-search-toggle" id="site-search-toggle" aria-label="Search this website" title="Search this website">'+icon+'</button>';
    const theme = list.querySelector("#theme-toggle");
    const themeItem = theme && theme.closest("li");
    if (themeItem) list.insertBefore(item, themeItem); else list.appendChild(item);
    $("site-search-toggle").addEventListener("click", openSearch);
  }
  function openSearch() {
    const overlay = $("site-search-overlay");
    const input = $("site-search-input");
    if (!overlay || !input) return;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    loadIndex();
    window.setTimeout(() => input.focus(), 30);
  }
  function closeSearch() {
    const overlay = $("site-search-overlay");
    if (!overlay) return;
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }
  function googleUrl(query) {
    return "https://www.google.com/search?q=" + encodeURIComponent(query);
  }
  function renderResults(query, hits) {
    const target = $("site-search-results");
    if (!target) return;
    if (!query) { target.replaceChildren(); return; }
    if (!hits.length) {
      target.innerHTML = '<div class="site-search-empty">No matching results found on this website.<br><a class="site-search-google" href="'+googleUrl(query)+'" target="_blank" rel="noopener noreferrer">Search Google for “'+escapeHtml(query)+'” ↗</a></div>';
      return;
    }
    target.innerHTML = hits.map(item => '<a class="site-search-result-item" href="'+escapeHtml(item.url)+'"><div class="site-search-result-title"><span class="site-search-result-category">'+escapeHtml(item.category || "Page")+'</span>'+escapeHtml(item.title)+'</div><div class="site-search-result-excerpt">'+escapeHtml(item.excerpt || "")+'</div></a>').join("");
  }
  async function search(query) {
    const clean = query.trim();
    if (!clean) { renderResults("", []); return; }
    const items = await loadIndex();
    const terms = clean.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const ranked = items.map(item => {
      const title = String(item.title || "").toLocaleLowerCase();
      const excerpt = String(item.excerpt || "").toLocaleLowerCase();
      const category = String(item.category || "").toLocaleLowerCase();
      const keywords = String(item.keywords || "").toLocaleLowerCase();
      const haystack = title+" "+excerpt+" "+category+" "+keywords;
      const matched = terms.filter(term => haystack.includes(term)).length;
      let score = matched * 3;
      if (title.includes(clean.toLocaleLowerCase())) score += 8;
      if (keywords.includes(clean.toLocaleLowerCase())) score += 4;
      if (title.startsWith(clean.toLocaleLowerCase())) score += 3;
      return { item, score, matched };
    }).filter(row => row.matched === terms.length && row.score > 0)
      .sort((a,b) => b.score-a.score)
      .slice(0,12)
      .map(row => row.item);
    renderResults(clean, ranked);
  }
  window.openSiteSearch = openSearch;
  window.closeSiteSearch = closeSearch;
  function init() {
    const nav = document.querySelector(".nav-links");
    if (!nav) return;
    ensureModal();
    addSearchButton();
    const input = $("site-search-input");
    if (input && !input.dataset.universalSearchBound) {
      input.dataset.universalSearchBound = "true";
      let lastQuery = "";
      input.addEventListener("input", () => {
        lastQuery = input.value;
        search(lastQuery);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          const first = $("site-search-results")?.querySelector(".site-search-result-item");
          if (first) window.location.href = first.href;
          else if (input.value.trim()) window.open(googleUrl(input.value.trim()), "_blank", "noopener");
        }
      });
    }
    document.querySelectorAll(".site-search-close").forEach(button => button.addEventListener("click", closeSearch));
    const overlay = $("site-search-overlay");
    if (overlay && !overlay.dataset.universalSearchBound) {
      overlay.dataset.universalSearchBound = "true";
      overlay.addEventListener("click", event => { if (event.target === overlay) closeSearch(); });
    }
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeSearch();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
