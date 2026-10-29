import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { ConnectorError } from "../src/errors.js";
import { AUTH_HEADER } from "../src/http.js";
import { createRuntime } from "../src/runtime.js";

const KEY = "super-secret/key+value=99";
const URL = "https://abs.test";
const recordSchema = z.object({ id: z.string(), title: z.string() });

function runtimeFor(options: {
  fetchImpl: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}) {
  return createRuntime(
    loadConfig({ ABS_BASE_URL: URL, ABS_API_TOKEN: KEY, ...options.env }, []),
    {
      fetchImpl: options.fetchImpl,
      ...(options.now === undefined ? {} : { now: options.now }),
    },
  );
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  const record = input as { url?: unknown; href?: unknown };
  if (typeof record.url === "string") return record.url;
  if (typeof record.href === "string") return record.href;
  return "";
}

describe("HttpClient", () => {
  it("sends the token as Authorization Bearer, caches the parsed body, and does not put the token in the url", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      urls.push(requestUrl(input));
      return Promise.resolve(Response.json({ id: "rec-1", title: "Widget" }));
    });
    let now = 0;
    const runtime = runtimeFor({
      fetchImpl,
      env: { ABS_CACHE_TTL_SEC: "30" },
      now: () => now,
    });
    const first = await runtime.client.getJson(
      { path: "api/libraries", query: undefined, ttlSec: 30 },
      recordSchema,
    );
    const second = await runtime.client.getJson(
      { path: "api/libraries", query: undefined, ttlSec: 30 },
      recordSchema,
    );
    expect(first).toEqual({ id: "rec-1", title: "Widget" });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get(AUTH_HEADER)).toBe(`Bearer ${KEY}`);
    expect(urls.join("\n")).not.toContain(KEY);
    expect(urls[0]).toBe(`${URL}/api/libraries`);
    now = 31_000;
    await runtime.client.getJson({ path: "api/libraries", query: undefined, ttlSec: 30 }, recordSchema);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not spend the rate limit on a cache hit and blocks the next miss", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ id: "1", title: "A" })),
    );
    const runtime = runtimeFor({
      fetchImpl,
      env: { ABS_PER_MINUTE: "1", ABS_CACHE_TTL_SEC: "60" },
      now: () => 0,
    });
    await runtime.client.getJson({ path: "api/libraries", query: undefined, ttlSec: 60 }, recordSchema);
    await runtime.client.getJson({ path: "api/libraries", query: undefined, ttlSec: 60 }, recordSchema);
    await expect(
      runtime.client.getJson({ path: "api/me", query: undefined, ttlSec: 60 }, recordSchema),
    ).rejects.toMatchObject({ code: "rate_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("redacts a secret that the upstream body or a network error tried to echo", async () => {
    const logs: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw new Error(`connect failed ${KEY} ${encodeURIComponent(KEY)}`);
    });
    const runtime = createRuntime(loadConfig({ ABS_BASE_URL: URL, ABS_API_TOKEN: KEY }, []), {
      fetchImpl,
      logger: { info: () => undefined, error: (message) => logs.push(message) },
    });
    await expect(
      runtime.client.getJson({ path: "api/libraries", query: undefined, ttlSec: 0 }, recordSchema),
    ).rejects.toThrow(ConnectorError);
    try {
      await runtime.client.getJson(
        { path: "api/libraries", query: undefined, ttlSec: 0 },
        recordSchema,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorError);
      if (!(error instanceof ConnectorError)) throw error;
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain(encodeURIComponent(KEY));
      expect(error.message).toContain("[redacted]");
    }
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("refuses to put the token in the query string", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ id: "1", title: "A" })));
    const runtime = runtimeFor({ fetchImpl });
    await expect(
      runtime.client.getJson(
        { path: "api/libraries/lib1/search", query: { q: KEY }, ttlSec: 0 },
        recordSchema,
      ),
    ).rejects.toThrow(/request URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps timeout, not found, and too many requests", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          reject(new Error("missing abort signal"));
          return;
        }
        const abort = (): void => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    const timeoutRuntime = runtimeFor({
      fetchImpl: hanging,
      env: { ABS_TIMEOUT_MS: "1000" },
    });
    await expect(
      timeoutRuntime.client.getJson({ path: "api/libraries", query: undefined, ttlSec: 0 }, recordSchema),
    ).rejects.toMatchObject({ code: "timeout" });

    const notFound = vi.fn<typeof fetch>(() => Promise.resolve(new Response("missing", { status: 404 })));
    await expect(
      runtimeFor({ fetchImpl: notFound }).client.getJson(
        { path: "api/libraries", query: undefined, ttlSec: 0 },
        recordSchema,
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const limited = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(`slow ${KEY}`, { status: 429, headers: { "retry-after": "4" } })),
    );
    try {
      await runtimeFor({ fetchImpl: limited }).client.getJson(
        { path: "api/libraries", query: undefined, ttlSec: 0 },
        recordSchema,
      );
      throw new Error("expected rate limit");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectorError);
      if (!(error instanceof ConnectorError)) throw error;
      expect(error.code).toBe("rate_limit");
      expect(error.retryAfterSeconds).toBe(4);
      expect(error.message).not.toContain(KEY);
    }
  });
});
