/* Shared site footer: one consistent footer across public pages. */
(() => {
  "use strict";
  const render = () => {
    const current = document.querySelector("footer");
    if (!current || current.dataset.sharedFooter === "true") return;

    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "/shared-footer.css?v=20261123";
    document.head.appendChild(style);

    const footer = document.createElement("footer");
    footer.className = "site-footer";
    footer.dataset.sharedFooter = "true";
    footer.innerHTML = `
      <div class="site-footer-inner">
        <div class="site-footer-brand">
          <a class="site-footer-logo" href="/">BIKASH BHANDARI ACCA<span>.</span></a>
          <p>Accounting, finance and practical digital tools for learning and business.</p>
        </div>
        <nav class="site-footer-column" aria-label="Explore">
          <h2>Explore</h2>
          <a href="/">Home</a>
          <a href="/about.html">About</a>
          <a href="/services.html">Services</a>
          <a href="/resources/">Resources</a>
          <a href="/tools.html">Tools</a>
          <a href="/contact.html">Contact</a>
        </nav>
        <nav class="site-footer-column" aria-label="Professional resources">
          <h2>Professional resources</h2>
          <a href="https://www.accaglobal.com/" target="_blank" rel="noopener noreferrer">ACCA Global</a>
          <a href="https://www.ican.org.np/" target="_blank" rel="noopener noreferrer">ICAN Nepal</a>
          <a href="https://www.ifrs.org/" target="_blank" rel="noopener noreferrer">IFRS Foundation</a>
          <a href="https://www.ifac.org/" target="_blank" rel="noopener noreferrer">IFAC</a>
          <a href="https://www.nepalstock.com.np/" target="_blank" rel="noopener noreferrer">NEPSE</a>
          <a href="https://www.nrb.org.np/" target="_blank" rel="noopener noreferrer">Nepal Rastra Bank</a>
          <a href="https://ird.gov.np/" target="_blank" rel="noopener noreferrer">Inland Revenue Department</a>
        </nav>
        <nav class="site-footer-column" aria-label="Connect">
          <h2>Connect</h2>
          <a href="https://www.facebook.com/iambeekas" target="_blank" rel="noopener noreferrer">Facebook</a>
          <a href="https://www.instagram.com/iambeekas" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href="https://x.com/iambeekas" target="_blank" rel="noopener noreferrer">X</a>
          <a href="https://www.linkedin.com/in/imbeekas/" target="_blank" rel="noopener noreferrer">LinkedIn</a>
        </nav>
      </div>
      <div class="site-footer-bottom">
        <span>© <span class="site-footer-year"></span> Bikash Bhandari. All rights reserved.</span>
        <nav aria-label="Legal">
          <a href="/privacy-policy.html">Privacy</a>
          <a href="/disclaimer.html">Disclaimer</a>
          <a href="/sitemap.xml">Sitemap</a>
        </nav>
      </div>`;
    footer.querySelector(".site-footer-year").textContent = String(new Date().getFullYear());
    current.replaceWith(footer);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
