/**
 * BikasB site Worker.
 * Handles the legacy Contentful URL and privacy-first aggregate analytics.
 * Static files continue to be served by the ASSETS binding.
 */
const ALLOWED_ORIGIN = "https://bikasb.com.np";
const EVENT_TYPES = new Set([
  "page_view",
  "tool_selected",
  "processing_started",
  "processing_completed",
  "processing_failed"
]);
const TOOL_IDS = new Set([
  "merge", "split", "rotate", "delete", "numbers", "images-pdf",
  "append-images", "pdf-images", "pageManager", "reorder", "duplicate",
  "blank", "textstamp", "image-overlay", "annotations", "metadata",
  "extract", "compress", "pptx-pdf", "office-pdf", "pdf-excel",
  "pdf-word", "ocr", "text"
]);
const DEVICE_TYPES = new Set(["mobile", "tablet", "desktop", "unknown"]);
const FILE_SIZE_BUCKETS = new Set([
  "unknown", "lt_1mb", "1_5mb", "5_10mb", "10_25mb"
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function validEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  if (!EVENT_TYPES.has(event.type)) return false;
  if (typeof event.toolId !== "string" || !TOOL_IDS.has(event.toolId)) return false;
  if (!DEVICE_TYPES.has(event.deviceType)) return false;
  if (!FILE_SIZE_BUCKETS.has(event.fileSizeBucket)) return false;
  if (!Number.isInteger(event.durationMs) || event.durationMs < 0 || event.durationMs > 86400000) return false;
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === "/post.html" &&
      url.searchParams.get("id") === "55bf63glfw3loksBmWcOps"
    ) {
      return Response.redirect("https://bikasb.com.np/blog.html", 301);
    }

    if (url.pathname === "/api/analytics") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      if (request.headers.get("Origin") !== ALLOWED_ORIGIN) {
        return json({ error: "Forbidden origin" }, 403);
      }
      if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
        return json({ error: "JSON required" }, 415);
      }
      const declaredLength = Number(request.headers.get("Content-Length") || 0);
      if (declaredLength > 8192) return json({ error: "Request too large" }, 413);

      let payload;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 8192) {
          return json({ error: "Request too large" }, 413);
        }
        payload = JSON.parse(raw);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (!payload || !Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > 20) {
        return json({ error: "Invalid event batch" }, 400);
      }
      if (!payload.events.every(validEvent)) {
        return json({ error: "Invalid event data" }, 400);
      }
      if (!env.ANALYTICS_DB) {
        return json({ error: "Analytics storage is not configured" }, 503);
      }

      const day = new Date().toISOString().slice(0, 10);
      const statements = payload.events.map(event =>
        env.ANALYTICS_DB.prepare(
          `INSERT INTO daily_tool_metrics
            (day, tool_id, event_type, device_type, file_size_bucket, event_count, duration_ms_total, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(day, tool_id, event_type, device_type, file_size_bucket)
           DO UPDATE SET
             event_count = event_count + 1,
             duration_ms_total = duration_ms_total + excluded.duration_ms_total,
             updated_at = CURRENT_TIMESTAMP`
        ).bind(
          day,
          event.toolId,
          event.type,
          event.deviceType,
          event.fileSizeBucket,
          event.durationMs
        )
      );

      try {
        await env.ANALYTICS_DB.batch(statements);
        return json({ ok: true, accepted: statements.length });
      } catch {
        return json({ error: "Analytics write failed" }, 503);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
