import type { ApiErrorBody } from "./types";

/** Error carrying the backend's normalised envelope: {error: {code, message, fields}}. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isUnauthenticated() {
    return this.status === 401;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function readCookie(name: string, cookieString: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function browserCookies() {
  return typeof document === "undefined" ? "" : document.cookie;
}

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | undefined;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const e = body?.error;
  return new ApiError(res.status, e?.code ?? "error", e?.message || res.statusText || "Request failed", e?.fields ?? {});
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined | null>;
  fetchImpl?: typeof fetch;
  cookies?: string;
}

/**
 * Same-origin API call (Next.js proxies /api/* to Django).
 * Sends the session cookie and, on unsafe methods, the CSRF token header.
 * Authorization is decided by the backend; never rely on the UI hiding things.
 */
export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method ?? (opts.body !== undefined ? "POST" : "GET")).toUpperCase();
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") query.set(k, String(v));
  }
  const url = query.size ? `${path}?${query}` : path;

  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (UNSAFE.has(method)) {
    const token = readCookie("csrftoken", opts.cookies ?? browserCookies());
    if (token) headers["X-CSRFToken"] = token;
  }

  const res = await (opts.fetchImpl ?? fetch)(url, { method, headers, body, credentials: "same-origin" });
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Ensure the csrftoken cookie exists (call before the login POST). */
export function ensureCsrf(fetchImpl?: typeof fetch) {
  return api("/api/auth/csrf/", { fetchImpl });
}
