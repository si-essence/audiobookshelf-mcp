import { describe, expect, it } from "vitest";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "../src/constants.js";
import { loadConfig } from "../src/config.js";
import { ConnectorError } from "../src/errors.js";
import { DEFAULT_TOOLSETS } from "../src/operations.js";

const KEY = "super-secret/key+value=99";
const URL = "http://127.0.0.1:13378";

function messageOf(error: unknown): string {
  expect(error).toBeInstanceOf(ConnectorError);
  if (!(error instanceof ConnectorError)) throw error;
  return error.message;
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

const base = { ABS_BASE_URL: URL, ABS_API_TOKEN: KEY };

describe("loadConfig", () => {
  it("requires ABS_BASE_URL", () => {
    const message = messageOf(catchError(() => loadConfig({ ABS_API_TOKEN: KEY }, [])));
    expect(message).toContain("ABS_BASE_URL");
    expect(message).toContain("required");
    expect(message).not.toContain(KEY);
  });

  it("requires ABS_API_TOKEN", () => {
    const message = messageOf(catchError(() => loadConfig({ ABS_BASE_URL: URL }, [])));
    expect(message).toContain("ABS_API_TOKEN");
    expect(message).toContain("required");
  });

  it("applies defaults when url and token are set", () => {
    const config = loadConfig(base, []);
    expect(config.token).toBe(KEY);
    expect(config.baseUrl).toBe(URL);
    expect(config.allowWrites).toBe(false);
    expect(config.toolsets).toEqual([...DEFAULT_TOOLSETS]);
    expect(config.perMinute).toBe(30);
    expect(config.timeoutMs).toBe(20_000);
    expect(config.contact).toBe("contact@example.com");
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(3000);
    expect(config.cacheTtlSec).toBe(60);
    expect(config.userAgent).toBe(`${CONNECTOR_NAME}/${CONNECTOR_VERSION} (contact@example.com)`);
  });

  it("lets --http override the transport", () => {
    expect(loadConfig({ ...base, MCP_TRANSPORT: "stdio" }, ["node", "app", "--http"]).transport).toBe(
      "http",
    );
    expect(loadConfig({ ...base, MCP_TRANSPORT: "http" }, []).transport).toBe("http");
  });

  it("enables writes only when ABS_ALLOW_WRITES is the literal true", () => {
    expect(loadConfig({ ...base, ABS_ALLOW_WRITES: "true" }, []).allowWrites).toBe(true);
    expect(loadConfig({ ...base, ABS_ALLOW_WRITES: "TRUE" }, []).allowWrites).toBe(false);
    expect(loadConfig({ ...base, ABS_ALLOW_WRITES: "1" }, []).allowWrites).toBe(false);
  });

  it("parses ABS_TOOLSETS", () => {
    expect(loadConfig({ ...base, ABS_TOOLSETS: "all" }, []).toolsets).toContain("users");
    expect(loadConfig({ ...base, ABS_TOOLSETS: "all" }, []).toolsets).toContain("admin");
    expect(loadConfig({ ...base, ABS_TOOLSETS: "libraries, me" }, []).toolsets).toEqual([
      "libraries",
      "me",
    ]);
  });

  it("rejects an unknown toolset without echoing the value", () => {
    const message = messageOf(catchError(() => loadConfig({ ...base, ABS_TOOLSETS: "nope" }, [])));
    expect(message).toContain("ABS_TOOLSETS");
    expect(message).not.toContain("nope");
  });

  it("refuses userinfo, query, hash, and path on ABS_BASE_URL", () => {
    expect(
      messageOf(catchError(() => loadConfig({ ...base, ABS_BASE_URL: "http://u:p@127.0.0.1:13378" }, []))),
    ).toContain("userinfo");
    expect(
      messageOf(catchError(() => loadConfig({ ...base, ABS_BASE_URL: "http://127.0.0.1:13378/?x=1" }, []))),
    ).toContain("query_or_hash");
    expect(
      messageOf(catchError(() => loadConfig({ ...base, ABS_BASE_URL: "http://127.0.0.1:13378/api" }, []))),
    ).toContain("path");
  });

  it("does not put the token in config error text", () => {
    const message = messageOf(
      catchError(() => loadConfig({ ABS_BASE_URL: "not-a-url", ABS_API_TOKEN: KEY }, [])),
    );
    expect(message).not.toContain(KEY);
  });
});
