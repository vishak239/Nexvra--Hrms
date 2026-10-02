import { describe, expect, it, vi } from "vitest";
import { ApiError, api, readCookie } from "./api";

function fakeFetch(status: number, body?: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected the request to fail");
}

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie("csrftoken", "a=1; csrftoken=abc%3D; b=2")).toBe("abc=");
    expect(readCookie("missing", "a=1")).toBeUndefined();
  });
});

describe("api", () => {
  it("sends the CSRF header on unsafe methods only", async () => {
    const f = fakeFetch(200, { ok: true });
    await api("/api/x/", { method: "POST", body: { a: 1 }, fetchImpl: f, cookies: "csrftoken=tok" });
    await api("/api/x/", { fetchImpl: f, cookies: "csrftoken=tok" });
    const post = f.mock.calls[0][1] as RequestInit;
    const get = f.mock.calls[1][1] as RequestInit;
    expect((post.headers as Record<string, string>)["X-CSRFToken"]).toBe("tok");
    expect((get.headers as Record<string, string>)["X-CSRFToken"]).toBeUndefined();
    expect(post.credentials).toBe("same-origin");
  });

  it("builds query strings and drops empty params", async () => {
    const f = fakeFetch(200, {});
    await api("/api/employees/", { params: { page: 2, search: "", status: undefined }, fetchImpl: f });
    expect(f.mock.calls[0][0]).toBe("/api/employees/?page=2");
  });

  it("normalises the backend error envelope", async () => {
    const f = fakeFetch(400, { error: { code: "validation_error", message: "Bad", fields: { email: ["x"] } } });
    const err = await failure(api("/api/x/", { method: "POST", body: {}, fetchImpl: f }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(err.fields.email).toEqual(["x"]);
  });

  it("flags unauthenticated responses", async () => {
    const f = fakeFetch(401, { error: { code: "not_authenticated", message: "No", fields: {} } });
    const err = await failure(api("/api/auth/me/", { fetchImpl: f }));
    expect(err.isUnauthenticated).toBe(true);
  });

  it("returns undefined for 204", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(api("/api/auth/logout/", { method: "POST", fetchImpl: f })).resolves.toBeUndefined();
  });
});
