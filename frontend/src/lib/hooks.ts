"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";

type Params = Record<string, string | number | boolean | undefined | null>;

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(0, "network_error", "Could not reach the server. Check your connection and try again.");
}

/** Fetches a resource and refetches when the path/params change. Pass `null` to skip. */
export function useResource<T>(path: string | null, params?: Params) {
  const key = path === null ? null : `${path}?${JSON.stringify(params ?? {})}`;
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(path !== null);
  const [version, setVersion] = useState(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(undefined);
    api<T>(path, { params: paramsRef.current })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(toApiError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}

/** Wraps an async action with pending + field-error state for forms and buttons. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);

  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setPending(true);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(toApiError(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, setError };
}

/** One-shot call that never throws: {ok: true, data} or {ok: false, error}. */
export async function tryApi<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

/** Returns `value` once it has stopped changing for `ms` (for search boxes). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
