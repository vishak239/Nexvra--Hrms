/**
 * Same-origin API proxy: the browser only talks to Next.js; /api/* is forwarded to Django.
 *
 * A route handler (instead of a next.config rewrite) lets us answer cleanly when the
 * backend is down: one short log line and a JSON 503 the UI can show, instead of a
 * stack trace per request.
 */

export const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

// Request headers that must not be forwarded (hop-by-hop, or recomputed by fetch).
const DROP_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
]);
// Response headers that must not be copied (fetch already decoded the body; cookies handled separately).
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie"]);

const TIMEOUT_MS = 60_000;
let lastWarning = 0;

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, fields: {} } }, { status, headers: { "Cache-Control": "no-store" } });
}

function warnOnce(message: string) {
  const now = Date.now();
  if (now - lastWarning > 10_000) {
    lastWarning = now;
    console.warn(`[nexvra-hrms] ${message}`);
  }
}

export async function proxyToBackend(
  req: Request,
  { backend = BACKEND_URL, fetchImpl = fetch }: { backend?: string; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const url = new URL(req.url);
  const target = `${backend}${url.pathname}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = req.method.toUpperCase();
  // Buffered (not streamed): Django's development server does not accept chunked request bodies.
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

  let res: Response;
  try {
    res = await fetchImpl(target, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      warnOnce(`Backend at ${backend} did not answer within ${TIMEOUT_MS / 1000}s (${method} ${url.pathname}).`);
      return errorResponse(504, "backend_timeout", "The server took too long to respond. Please try again.");
    }
    warnOnce(
      `Backend not reachable at ${backend}. Start it first: cd backend && .venv\\Scripts\\python manage.py runserver 127.0.0.1:8000 (or run start-hrms.bat).`,
    );
    return errorResponse(
      503,
      "backend_unavailable",
      "Can't reach the Nexvra HRMS server. Please make sure the backend is running, then try again.",
    );
  }

  const out = new Headers();
  res.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key.toLowerCase())) out.set(key, value);
  });
  for (const cookie of res.headers.getSetCookie()) out.append("set-cookie", cookie);
  // Never leak the internal backend address in redirects.
  const location = out.get("location");
  if (location?.startsWith(backend)) out.set("location", location.slice(backend.length) || "/");

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
