/* BikasB optional, first-party aggregate analytics. No cookies or visitor IDs. */
(() => {
  "use strict";
  const CONSENT_KEY = "bikasb-analytics-consent";
  const panel = document.getElementById("analytics-consent");
  const accept = document.getElementById("analytics-accept");
  const reject = document.getElementById("analytics-reject");
  const settings = document.getElementById("analytics-settings");
  const status = document.getElementById("analytics-consent-status");
  let queue = [];
  let flushTimer = null;

  function choice() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return "no"; }
  }
  function setChoice(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
    render();
    if (value === "yes") track("page_view", "site");
    else queue = [];
  }
  function render() {
    const selected = choice();
    if (panel) panel.hidden = selected === "yes" || selected === "no";
    if (status) status.textContent = selected === "yes"
      ? "Optional analytics enabled."
      : selected === "no" ? "Optional analytics disabled." : "No choice saved.";
  }
  function deviceType() {
    const width = window.innerWidth || 0;
    if (width < 600) return "mobile";
    if (width < 1024) return "tablet";
    return "desktop";
  }
  function sizeBucket(files) {
    if (!files || !files.length) return "unknown";
    const total = Array.from(files).reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    if (total < 1024 * 1024) return "lt_1mb";
    if (total < 5 * 1024 * 1024) return "1_5mb";
    if (total < 10 * 1024 * 1024) return "5_10mb";
    return "10_25mb";
  }
  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (choice() !== "yes" || !queue.length) { queue = []; return; }
    const events = queue.splice(0, 20);
    fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true
    }).catch(() => {});
    if (queue.length) flushTimer = setTimeout(flush, 1000);
  }
  function track(type, toolId, files, durationMs) {
    if (choice() !== "yes") return;
    queue.push({
      type,
      toolId: toolId || "merge",
      deviceType: deviceType(),
      fileSizeBucket: sizeBucket(files),
      durationMs: Math.max(0, Math.min(86400000, Math.round(durationMs || 0)))
    });
    if (queue.length >= 10) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 1800);
  }

  accept?.addEventListener("click", () => setChoice("yes"));
  reject?.addEventListener("click", () => setChoice("no"));
  settings?.addEventListener("click", () => {
    if (panel) {
      panel.hidden = false;
      panel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });
  window.addEventListener("pagehide", flush);
  render();
  if (choice() === "yes") track("page_view", "site");

  window.BikasBAnalytics = { track };
})();
