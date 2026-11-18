/**
 * BikasB site Worker.
 * Static assets, opt-in aggregate analytics, and password-protected admin reporting.
 */
const ALLOWED_ORIGIN = "https://bikasb.com.np";
const EVENT_TYPES = new Set(["page_view","tool_selected","processing_started","processing_completed","processing_failed"]);
const TOOL_IDS = new Set([
  "site", "merge", "split", "rotate", "delete", "numbers", "images-pdf",
  "append-images", "pdf-images", "pageManager", "reorder", "duplicate",
  "blank", "textstamp", "image-overlay", "annotations", "metadata",
  "extract", "compress", "pptx-pdf", "office-pdf", "pdf-excel",
  "pdf-word", "ocr", "text"
]);
const DEVICE_TYPES = new Set(["mobile", "tablet", "desktop", "unknown"]);
const FILE_SIZE_BUCKETS = new Set(["unknown","lt_1mb","1_5mb","5_10mb","10_25mb"]);
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...headers}});
}
function validEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  return EVENT_TYPES.has(event.type) && typeof event.toolId === "string" && TOOL_IDS.has(event.toolId) && DEVICE_TYPES.has(event.deviceType) && FILE_SIZE_BUCKETS.has(event.fileSizeBucket) && Number.isInteger(event.durationMs) && event.durationMs >= 0 && event.durationMs <= 86400000;
}
function b64url(bytes) { let out=""; for (const b of new Uint8Array(bytes)) out+=String.fromCharCode(b); return btoa(out).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function unb64url(value) { const b=value.replace(/-/g,"+").replace(/_/g,"/"); return Uint8Array.from(atob(b+"=".repeat((4-b.length%4)%4)),c=>c.charCodeAt(0)); }
async function signSession(expiry, secret) { const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]); return b64url(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode("bikasb-admin-v1:"+expiry))); }
async function createSession(secret) { const expiry=Math.floor(Date.now()/1000)+28800; return expiry+"."+await signSession(expiry,secret); }
async function validSession(request,env) {
  const secret=String(env.ADMIN_SESSION_SECRET||""); if(secret.length<32) return false;
  const match=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)bikasb_admin_session=([A-Za-z0-9_.-]+)/); if(!match) return false;
  const parts=match[1].split("."); if(parts.length!==2||!/^\d{10}$/.test(parts[0])) return false;
  const expiry=Number(parts[0]),now=Math.floor(Date.now()/1000); if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+28800) return false;
  try { const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]); return await crypto.subtle.verify("HMAC",key,unb64url(parts[1]),new TextEncoder().encode("bikasb-admin-v1:"+parts[0])); } catch { return false; }
}
function sessionCookie(value,maxAge=28800) { return "bikasb_admin_session="+value+"; Path=/admin; Max-Age="+maxAge+"; HttpOnly; Secure; SameSite=Strict"; }
async function adminLogin(request,env) {
  if(request.method!=="POST") return json({error:"Method not allowed"},405,{Allow:"POST"});
  if(request.headers.get("Origin")!==ALLOWED_ORIGIN) return json({error:"Forbidden origin"},403);
  if(!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")) return json({error:"JSON required"},415);
  if(String(env.ADMIN_PASSWORD||"").length<16||String(env.ADMIN_SESSION_SECRET||"").length<32) return json({error:"Admin login is not configured. Add the required Worker secrets."},503);
  let payload; try { const raw=await request.text(); if(new TextEncoder().encode(raw).byteLength>4096) return json({error:"Request too large"},413); payload=JSON.parse(raw); } catch { return json({error:"Invalid JSON"},400); }
  if(!payload||typeof payload.password!=="string"||payload.password.length>1024) return json({error:"Invalid credentials"},401);
  const enc=new TextEncoder(); const [a,b]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(payload.password)),crypto.subtle.digest("SHA-256",enc.encode(String(env.ADMIN_PASSWORD)))]);
  const x=new Uint8Array(a),y=new Uint8Array(b); let diff=0; for(let i=0;i<x.length;i++) diff|=x[i]^y[i]; if(diff!==0) return json({error:"Incorrect password."},401);
  return json({ok:true},200,{"set-cookie":sessionCookie(await createSession(String(env.ADMIN_SESSION_SECRET)))});
}
async function adminLogout(request) { if(request.method!=="POST") return json({error:"Method not allowed"},405,{Allow:"POST"}); if(request.headers.get("Origin")!==ALLOWED_ORIGIN) return json({error:"Forbidden origin"},403); return json({ok:true},200,{"set-cookie":sessionCookie("",0)}); }
function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}
async function adminAnalytics(request, env) {
  if (request.method !== "GET") return json({error:"Method not allowed"},405);
  if (!env.ANALYTICS_DB) return json({error:"Analytics database is not configured"},503);
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0,10);
  const defaultStart = new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  const start = url.searchParams.get("start") || defaultStart;
  const end = url.searchParams.get("end") || today;
  if (!validDay(start) || !validDay(end) || start > end ||
      (Date.parse(end+"T00:00:00Z")-Date.parse(start+"T00:00:00Z"))/86400000 > 365) {
    return json({error:"Use a valid date range of no more than 366 days."},400);
  }
  const db = env.ANALYTICS_DB;
  const range = [start,end];
  try {
    const [summary,daily,tools,devices,sizes] = await Promise.all([
      db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN event_type='page_view' THEN event_count ELSE 0 END),0) AS page_views,
        COALESCE(SUM(CASE WHEN event_type='tool_selected' THEN event_count ELSE 0 END),0) AS tool_selections,
        COALESCE(SUM(CASE WHEN event_type='processing_started' THEN event_count ELSE 0 END),0) AS processing_started,
        COALESCE(SUM(CASE WHEN event_type='processing_completed' THEN event_count ELSE 0 END),0) AS processing_completed,
        COALESCE(SUM(CASE WHEN event_type='processing_failed' THEN event_count ELSE 0 END),0) AS processing_failed,
        COALESCE(SUM(CASE WHEN event_type='processing_completed' THEN duration_ms_total ELSE 0 END),0) AS duration_ms_total
        FROM daily_tool_metrics WHERE day BETWEEN ? AND ?`).bind(...range).first(),
      db.prepare(`SELECT day,
        COALESCE(SUM(CASE WHEN event_type='page_view' THEN event_count ELSE 0 END),0) AS page_views,
        COALESCE(SUM(CASE WHEN event_type='processing_completed' THEN event_count ELSE 0 END),0) AS completed,
        COALESCE(SUM(CASE WHEN event_type='processing_failed' THEN event_count ELSE 0 END),0) AS failed
        FROM daily_tool_metrics WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`).bind(...range).all(),
      db.prepare(`SELECT tool_id,
        COALESCE(SUM(CASE WHEN event_type='tool_selected' THEN event_count ELSE 0 END),0) AS selections,
        COALESCE(SUM(CASE WHEN event_type='processing_started' THEN event_count ELSE 0 END),0) AS started,
        COALESCE(SUM(CASE WHEN event_type='processing_completed' THEN event_count ELSE 0 END),0) AS completed,
        COALESCE(SUM(CASE WHEN event_type='processing_failed' THEN event_count ELSE 0 END),0) AS failed,
        COALESCE(SUM(CASE WHEN event_type='processing_completed' THEN duration_ms_total ELSE 0 END),0) AS duration_ms_total
        FROM daily_tool_metrics WHERE day BETWEEN ? AND ? GROUP BY tool_id
        ORDER BY completed DESC, selections DESC LIMIT 50`).bind(...range).all(),
      db.prepare(`SELECT device_type, SUM(event_count) AS completed
        FROM daily_tool_metrics WHERE day BETWEEN ? AND ? AND event_type='processing_completed'
        GROUP BY device_type ORDER BY completed DESC`).bind(...range).all(),
      db.prepare(`SELECT file_size_bucket, SUM(event_count) AS completed
        FROM daily_tool_metrics WHERE day BETWEEN ? AND ? AND event_type='processing_completed'
        GROUP BY file_size_bucket ORDER BY completed DESC`).bind(...range).all()
    ]);
    const totals = summary || {};
    const completed = Number(totals.processing_completed || 0);
    return json({
      range:{start,end},
      summary:{
        page_views:Number(totals.page_views||0),
        tool_selections:Number(totals.tool_selections||0),
        processing_started:Number(totals.processing_started||0),
        processing_completed:completed,
        processing_failed:Number(totals.processing_failed||0),
        success_rate: (completed + Number(totals.processing_failed||0)) ?
          Math.round(completed/(completed+Number(totals.processing_failed||0))*1000)/10 : 0,
        average_duration_ms:completed ? Math.round(Number(totals.duration_ms_total||0)/completed) : 0
      },
      daily:daily.results||[], tools:tools.results||[], devices:devices.results||[], file_sizes:sizes.results||[]
    });
  } catch {
    return json({error:"Unable to read analytics data."},503);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/post.html" && url.searchParams.get("id") === "55bf63glfw3loksBmWcOps") {
      return Response.redirect("https://bikasb.com.np/blog.html",301);
    }
    if (url.pathname === "/api/analytics") {
      if (request.method !== "POST") return json({error:"Method not allowed"},405);
      if (request.headers.get("Origin") !== ALLOWED_ORIGIN) return json({error:"Forbidden origin"},403);
      if (!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")) return json({error:"JSON required"},415);
      const declaredLength = Number(request.headers.get("Content-Length")||0);
      if (declaredLength > 8192) return json({error:"Request too large"},413);
      let payload;
      try {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 8192) return json({error:"Request too large"},413);
        payload = JSON.parse(raw);
      } catch { return json({error:"Invalid JSON"},400); }
      if (!payload || !Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > 20) return json({error:"Invalid event batch"},400);
      if (!payload.events.every(validEvent)) return json({error:"Invalid event data"},400);
      if (!env.ANALYTICS_DB) return json({error:"Analytics storage is not configured"},503);
      const day = new Date().toISOString().slice(0,10);
      const statements = payload.events.map(event => env.ANALYTICS_DB.prepare(
        `INSERT INTO daily_tool_metrics
          (day,tool_id,event_type,device_type,file_size_bucket,event_count,duration_ms_total,updated_at)
         VALUES (?,?,?,?,?,1,?,CURRENT_TIMESTAMP)
         ON CONFLICT(day,tool_id,event_type,device_type,file_size_bucket)
         DO UPDATE SET event_count=event_count+1,duration_ms_total=duration_ms_total+excluded.duration_ms_total,updated_at=CURRENT_TIMESTAMP`
      ).bind(day,event.toolId,event.type,event.deviceType,event.fileSizeBucket,event.durationMs));
      try { await env.ANALYTICS_DB.batch(statements); return json({ok:true,accepted:statements.length}); }
      catch { return json({error:"Analytics write failed"},503); }
    }
    if (url.pathname === "/admin/api/login") return adminLogin(request,env);
    if (url.pathname === "/admin/api/logout") return adminLogout(request);
    if (url.pathname === "/admin/api/analytics") { if (!(await validSession(request,env))) return json({error:"Authentication required"},401); return adminAnalytics(request,env); }
    if (url.pathname === "/admin" || url.pathname === "/admin/") { const target=new URL(request.url); target.pathname="/admin/index.html"; return env.ASSETS.fetch(new Request(target.toString(),request)); }
    return env.ASSETS.fetch(request);
  }
};
