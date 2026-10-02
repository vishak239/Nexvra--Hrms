import { describe, expect, it, vi } from "vitest";
import { proxyToBackend } from "./proxy";

const BACKEND = "http://backend:8000";

describe("proxyToBackend", () => {
  it("forwards path, query, method, body and cookies, keeping the trailing slash", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "nexvra_session=abc; HttpOnly; Path=/");
      headers.append("set-cookie", "csrftoken=xyz; Path=/");
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    });
    const req = new Request("http://localhost:3000/api/auth/login/?next=%2Fx", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "csrftoken=t", "x-csrftoken": "t", host: "localhost:3000" },
      body: JSON.stringify({ email: "a@example.test" }),
    });

    const res = await proxyToBackend(req, { backend: BACKEND, fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BACKEND}/api/auth/login/?next=%2Fx`);
    expect(init?.method).toBe("POST");
    const sent = init?.headers as Headers;
    expect(sent.get("x-csrftoken")).toBe("t");
    expect(sent.get("cookie")).toBe("csrftoken=t");
    expect(sent.get("host")).toBeNull();
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"email":"a@example.test"}');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toHaveLength(2);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers 503 with a readable message when the backend is down", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await proxyToBackend(new Request("http://localhost:3000/api/auth/session/"), { backend: BACKEND, fetchImpl });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("backend_unavailable");
    expect(body.error.message).toMatch(/make sure the backend is running/);
    warn.mockRestore();
  });

  it("does not leak the backend address in redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { location: `${BACKEND}/api/x/` } }));
    const res = await proxyToBackend(new Request("http://localhost:3000/api/x"), { backend: BACKEND, fetchImpl });
    expect(res.headers.get("location")).toBe("/api/x/");
  });
});
