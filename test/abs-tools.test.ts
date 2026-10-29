import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";
import { OPERATIONS, toolIsWrite, toolNames, type Operation } from "../src/operations.js";
import { decideWrite, WRITES_DISABLED } from "../src/write-gate.js";
import { jsonFetch, jsonResponse, runtimeFor, TOKEN, type CapturedRequest } from "./harness.js";
import { connectServer } from "./mcp.js";
import { readToolText } from "./result.js";

const TOOL_NAMES = toolNames();
const WRITE_OPS = OPERATIONS.filter((operation) => operation.write);

function leakyBody(): Record<string, unknown> {
  return {
    id: 1,
    name: "ada",
    username: "ada",
    apiKey: TOKEN,
    email: "ada@example.com",
    key: "other-secret-key-value",
    password: "hunter2-secret-value",
    token: "jwt-token-value-xxxx",
    refreshToken: "refresh-token-value-xx",
    folders: ["/audiobooks/fiction"],
    stack: "at /var/abs/server/Server.js:10",
    title: `hello ${TOKEN}`,
  };
}

function argsFor(operation: Operation): Record<string, unknown> {
  const args: Record<string, unknown> = { action: operation.action };
  if (Object.keys(operation.sampleParams).length > 0) args["params"] = operation.sampleParams;
  if (Object.keys(operation.sampleQuery).length > 0) args["query"] = operation.sampleQuery;
  if (operation.sampleBody !== undefined) args["body"] = operation.sampleBody;
  return args;
}

async function withClient(
  fetchImpl: typeof fetch,
  extra: NodeJS.ProcessEnv,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const runtime = runtimeFor(fetchImpl, extra);
  const connected = await connectServer(runtime);
  try {
    await run(connected.client);
  } finally {
    await connected.close();
  }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; json: Record<string, unknown> | null }> {
  const result = readToolText(await client.callTool({ name, arguments: args }));
  expect(result.text).not.toContain(TOKEN);
  if (result.isError) return { ...result, json: null };
  return { ...result, json: JSON.parse(result.text) as Record<string, unknown> };
}

describe("audiobookshelf tools", () => {
  it("publishes every tool with a compact description and confirm on writes", async () => {
    const { fetchImpl } = jsonFetch(() => jsonResponse(leakyBody()));
    await withClient(fetchImpl, {}, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(TOOL_NAMES);
      for (const tool of listed.tools) {
        const description = tool.description ?? "";
        expect(description).toContain("action help");
        expect(description.length).toBeGreaterThan(40);
        expect(description).not.toContain("bodyFields");
        const schema = JSON.stringify(tool.inputSchema);
        expect(schema).toContain("help");
        if (toolIsWrite(tool.name)) expect(schema).toContain("confirm");
        else expect(schema).not.toContain("confirm");
      }
    });
  });

  it("scopes the published set to ABS_TOOLSETS", async () => {
    const { fetchImpl } = jsonFetch(() => jsonResponse({ ok: true }));
    await withClient(fetchImpl, { ABS_TOOLSETS: "libraries,me" }, async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["abs_libraries", "abs_me"]);
    });
    await withClient(fetchImpl, { ABS_TOOLSETS: undefined }, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "abs_authors",
        "abs_collections",
        "abs_genres",
        "abs_items",
        "abs_libraries",
        "abs_me",
        "abs_playlists",
        "abs_podcasts",
        "abs_search",
        "abs_series",
        "abs_sessions",
        "abs_stats",
        "abs_tags",
      ]);
      expect(names).not.toContain("abs_admin");
      expect(names).not.toContain("abs_users");
    });
  });

  it("describes one action without calling upstream", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(leakyBody()));
    await withClient(fetchImpl, {}, async (client) => {
      const described = await call(client, "abs_api_keys", {
        action: "help",
        target: "post",
      });
      expect(described.isError).toBe(false);
      expect(described.json).toMatchObject({
        action: "post",
        method: "POST",
        path: "/api/api-keys",
        write: true,
      });
      expect(JSON.stringify(described.json)).toContain("API key");
      expect(calls).toHaveLength(0);
    });
  });

  it("redacts account secrets, keeps names and library folders, and drops stack", async () => {
    const { fetchImpl, calls } = jsonFetch((captured) => {
      if (captured.authorization !== `Bearer ${TOKEN}`) {
        throw new Error("missing Authorization Bearer header");
      }
      return jsonResponse(leakyBody());
    });
    await withClient(fetchImpl, {}, async (client) => {
      const listed = await call(client, "abs_me", { action: "get" });
      expect(listed.isError).toBe(false);
      const raw = JSON.stringify(listed.json);
      expect(raw).toContain("ada");
      expect(raw).toContain("/audiobooks/fiction");
      expect(raw).toContain("[redacted]");
      expect(raw).not.toContain("ada@example.com");
      expect(raw).not.toContain("other-secret-key-value");
      expect(raw).not.toContain("hunter2-secret-value");
      expect(raw).not.toContain("jwt-token-value-xxxx");
      expect(raw).not.toContain("refresh-token-value-xx");
      expect(raw).not.toContain("Server.js");
      expect(raw).not.toContain("stack");
      expect(calls[0]?.url).toBe("https://abs.test/api/me");
      expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    });
  });

  it("reveals a new API key once and redacts it on the list", async () => {
    const minted = "brand-new-abs-api-key-value";
    const { fetchImpl, calls } = jsonFetch(() =>
      jsonResponse({ id: 9, apiKey: minted, name: "mcp", email: "ada@example.com" }),
    );
    await withClient(fetchImpl, {}, async (client) => {
      const preview = await call(client, "abs_api_keys", {
        action: "post",
        body: { name: "mcp" },
      });
      expect(preview.json).toMatchObject({ executed: false, dry_run: true, method: "POST" });
      expect(JSON.stringify(preview.json)).toContain("API key");
      expect(calls).toHaveLength(0);

      const created = await call(client, "abs_api_keys", {
        action: "post",
        body: { name: "mcp" },
        confirm: true,
      });
      expect(created.isError).toBe(false);
      expect(created.text).toContain(minted);
      expect(created.text).toContain("shown only once");
      expect(created.text).not.toContain("ada@example.com");

      const listed = await call(client, "abs_api_keys", { action: "get" });
      expect(listed.text).not.toContain(minted);
      expect(listed.text).toContain("[redacted]");
    });
  });

  it("blocks writes when ABS_ALLOW_WRITES is not true", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse({ ok: true }));
    await withClient(fetchImpl, { ABS_ALLOW_WRITES: "false" }, async (client) => {
      const result = await call(client, "abs_libraries", {
        action: "delete_by_id",
        params: { id: "4" },
        confirm: true,
      });
      expect(result.json).toMatchObject({
        executed: false,
        blocked: true,
        method: "DELETE",
        path: "api/libraries/4",
      });
      expect(JSON.stringify(result.json)).toContain("libraries");
      expect(calls).toHaveLength(0);
    });
  });

  it("rejects confirm false and the string true", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse({ ok: true }));
    await withClient(fetchImpl, {}, async (client) => {
      const asFalse = await call(client, "abs_libraries", {
        action: "delete_by_id",
        params: { id: "4" },
        confirm: false,
      });
      expect(asFalse.isError).toBe(true);
      const asString = await call(client, "abs_libraries", {
        action: "delete_by_id",
        params: { id: "4" },
        confirm: "true",
      });
      expect(asString.isError).toBe(true);
      expect(asString.text).toContain("confirm");
      expect(calls).toHaveLength(0);
    });
  });
});

describe("every registered tool", () => {
  it("guard: every tool is called as a read or a confirmed write, and every write is previewed", async () => {
    const seen = new Set<string>();
    const previewed = new Set<string>();
    const reachable = new Set<string>();
    const { fetchImpl, calls } = jsonFetch((captured: CapturedRequest) => {
      if (captured.authorization !== `Bearer ${TOKEN}`) {
        throw new Error("missing Authorization Bearer header");
      }
      if (captured.url.includes(TOKEN) || captured.url.includes(encodeURIComponent(TOKEN))) {
        throw new Error("token leaked into the url");
      }
      return jsonResponse(leakyBody());
    });
    await withClient(fetchImpl, { ABS_PER_MINUTE: "300" }, async (client) => {
      const listed = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(listed).toEqual(TOOL_NAMES);
      for (const operation of OPERATIONS) {
        reachable.add(`${operation.method} ${operation.path}`);
        if (operation.write) {
          calls.length = 0;
          const preview = await call(client, operation.tool, argsFor(operation));
          expect(preview.isError, `${operation.tool} ${operation.action} preview`).toBe(false);
          expect(preview.json).toMatchObject({
            executed: false,
            dry_run: true,
            blocked: false,
            method: operation.method,
          });
          expect(String(preview.json?.["path"]).startsWith("api/")).toBe(true);
          expect(calls).toHaveLength(0);
          previewed.add(operation.tool);
        }
        calls.length = 0;
        const args = operation.write ? { ...argsFor(operation), confirm: true } : argsFor(operation);
        const result = await call(client, operation.tool, args);
        expect(result.isError, `${operation.tool} ${operation.action}`).toBe(false);
        expect(result.text).not.toContain("ada@example.com");
        expect(result.text).not.toContain("hunter2-secret-value");
        expect(result.text).not.toContain("Server.js");
        if (!operation.revealSecret) expect(result.text).not.toContain("other-secret-key-value");
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
        expect(calls[0]?.method).toBe(operation.method);
        seen.add(operation.tool);
      }
    });
    expect([...seen].sort()).toEqual(TOOL_NAMES);
    const writeTools = [...new Set(WRITE_OPS.map((operation) => operation.tool))].sort();
    for (const name of writeTools) expect(previewed.has(name), name).toBe(true);
    expect(OPERATIONS.length).toBe(181);
    expect(WRITE_OPS.length).toBe(107);
    expect(reachable.size).toBe(181);
  }, 180_000);
});

describe("error paths", () => {
  it("maps 401, 403, 404, 422, 400, and 429 with Retry-After", async () => {
    const cases: { status: number; body: unknown; needle: string; retry?: string }[] = [
      {
        status: 401,
        body: { message: `Unauthorized ${TOKEN}`, stack: "at /tmp/audiobookshelf/Server.js:4" },
        needle: "[unauthorized]",
      },
      {
        status: 403,
        body: { message: "forbidden /var/audiobookshelf/config" },
        needle: "[forbidden]",
      },
      {
        status: 404,
        body: { title: "Library not found", stack: "at /tmp/audiobookshelf/x.js:2" },
        needle: "[not-found]",
      },
      {
        status: 422,
        body: { message: "name should not be empty" },
        needle: "[input]",
      },
      {
        status: 400,
        body: { errors: { name: ["required"] } },
        needle: "[input]",
      },
      {
        status: 429,
        body: { message: `slow ${TOKEN}` },
        needle: "[rate-limit]",
        retry: "9",
      },
    ];
    for (const item of cases) {
      const { fetchImpl } = jsonFetch(() =>
        jsonResponse(item.body, item.status, item.retry === undefined ? {} : { "retry-after": item.retry }),
      );
      await withClient(fetchImpl, {}, async (client) => {
        const result = await call(client, "abs_libraries", { action: "get" });
        expect(result.isError).toBe(true);
        expect(result.text).toContain(item.needle);
        expect(result.text).not.toContain(TOKEN);
        expect(result.text).not.toContain("/tmp/");
        expect(result.text).not.toContain("/var/audiobookshelf");
        expect(result.text).not.toContain("Server.js");
        if (item.retry !== undefined) expect(result.text).toContain(`retry after ${item.retry}s`);
      });
    }
  });
});

describe("write gate", () => {
  const plan = {
    method: "DELETE" as const,
    path: "api/libraries/1",
    query: undefined,
    body: undefined,
    summary: "delete",
    warnings: ["This deletes a library. It may be irreversible."],
    revealSecret: false,
  };

  it("previews when confirm is omitted", () => {
    const decision = decideWrite(true, undefined, plan, []);
    expect(decision.kind).toBe("preview");
    if (decision.kind !== "preview") return;
    expect(decision.payload).toMatchObject({ executed: false, dry_run: true, blocked: false });
  });

  it("blocks when confirm is true and writes are disabled", () => {
    const decision = decideWrite(false, true, plan, []);
    expect(decision.kind).toBe("preview");
    if (decision.kind !== "preview") return;
    expect(decision.payload).toMatchObject({ blocked: true, reason: WRITES_DISABLED });
  });

  it("executes only for boolean true plus allow writes", () => {
    expect(decideWrite(true, true, plan, []).kind).toBe("execute");
  });
});
