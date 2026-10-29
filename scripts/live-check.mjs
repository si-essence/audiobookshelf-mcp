#!/usr/bin/env node
/**
 * Live check against a real self-hosted Audiobookshelf. Spawns dist/index.js over stdio.
 * Skips when ABS_BASE_URL or ABS_API_TOKEN is unset. Prints pass/fail lines only.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const token = process.env["ABS_API_TOKEN"] ?? "";
const baseUrl = process.env["ABS_BASE_URL"] ?? "";

/** @type {string[]} */
const secrets = [];
if (token.length >= 8) secrets.push(token);

/**
 * @param {string} text
 */
function redact(text) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
    out = out.split(encodeURIComponent(secret)).join("[redacted]");
  }
  out = out.replace(/(authorization:\s*bearer\s+)\S+/gi, "Authorization: Bearer [redacted]");
  out = out.replace(
    /([?&#](?:api_key|apikey|api-key|token|key|password)=)[^&\s#]+/gi,
    "$1[redacted]",
  );
  out = out.replace(
    /"(apiKey|key|secret|token|refreshToken|password|email)"\s*:\s*"[^"]*"/gi,
    '"$1":"[redacted]"',
  );
  return out;
}

const writeLine = console.log.bind(console);
console.log = (line) => writeLine(redact(String(line)));
console.error = (line) => writeLine(redact(String(line)));

let failed = 0;
let passed = 0;

/**
 * @param {string} name
 * @param {boolean} ok
 */
function record(name, ok) {
  if (ok) passed += 1;
  else failed += 1;
  writeLine(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {string | undefined}
 */
function firstString(value, key) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const entry = value[key];
  if (typeof entry === "string" && entry.length > 0 && entry !== "[redacted]") return entry;
  if (typeof entry === "number" && Number.isFinite(entry)) return String(entry);
  for (const nested of Object.values(value)) {
    const found = firstString(nested, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * @param {import("@modelcontextprotocol/sdk/client/index.js").Client} client
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const block = Array.isArray(result.content) ? result.content[0] : undefined;
  const text = block && typeof block === "object" && "text" in block ? String(block.text) : "";
  if (token.length >= 8 && text.includes(token)) {
    throw new Error("secret leaked into tool output");
  }
  /** @type {Record<string, unknown> | null} */
  let json = null;
  try {
    const parsed = JSON.parse(text);
    json = isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    json = null;
  }
  if (result.isError === true && process.env["LIVE_DEBUG"] === "1") {
    writeLine(
      `  ERR ${name}/${String(args["action"])}: ${text.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
  return { isError: result.isError === true, text, json };
}

/**
 * @param {{ isError: boolean, text: string }} result
 */
function cleanMiss(result) {
  if (!result.isError) return false;
  if (/Server\.js|\.js:\d|stack trace|\/tmp\/|\/var\//i.test(result.text)) return false;
  return result.text.includes("[not-found]") || /not found|does not exist/i.test(result.text);
}

/**
 * @param {import("@modelcontextprotocol/sdk/client/index.js").Client} client
 * @param {string} name
 * @param {string} tool
 * @param {Record<string, unknown>} args
 */
async function readOk(client, name, tool, args) {
  const result = await call(client, tool, args);
  const leaked = token.length >= 8 && result.text.includes(token);
  record(name, !result.isError && !leaked && !/stack trace|Server\.js/i.test(result.text));
  return result;
}

async function main() {
  if (baseUrl.trim().length === 0 || token.trim().length < 8) {
    writeLine("SKIP  live-check  ABS_BASE_URL and ABS_API_TOKEN are unset.");
    return;
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: root,
    env: {
      ...process.env,
      ABS_BASE_URL: baseUrl,
      ABS_API_TOKEN: token,
      ABS_ALLOW_WRITES: "true",
      ABS_TOOLSETS: "all",
      ABS_CACHE_TTL_SEC: "0",
      ABS_PER_MINUTE: "300",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "audiobookshelf-live-check", version: "0" });
  await client.connect(transport);

  const stamp = Date.now().toString(36);
  /** @type {string | undefined} */
  let collectionId;
  /** @type {string | undefined} */
  let playlistId;

  try {
    const listed = await client.listTools();
    record("lists tools", Array.isArray(listed.tools) && listed.tools.length >= 13);

    const libraries = await readOk(client, "libraries", "abs_libraries", { action: "get" });
    const libraryId = firstString(libraries.json, "id");
    const me = await readOk(client, "me", "abs_me", { action: "get" });
    record(
      "me redacts token fields",
      firstString(me.json, "apiKey") === undefined &&
        firstString(me.json, "token") === undefined &&
        !me.text.includes(token),
    );
    await readOk(client, "collections", "abs_collections", { action: "get" });
    await readOk(client, "playlists", "abs_playlists", { action: "get" });
    await readOk(client, "sessions", "abs_sessions", { action: "get" });
    await readOk(client, "open sessions", "abs_sessions", { action: "get_open" });
    await readOk(client, "tags", "abs_tags", { action: "get" });
    await readOk(client, "genres", "abs_genres", { action: "get" });
    await readOk(client, "stats", "abs_stats", { action: "get_server" });
    await readOk(client, "search providers", "abs_search", { action: "get_providers" });
    await readOk(client, "users", "abs_users", { action: "get" });
    await readOk(client, "tasks", "abs_tasks", { action: "get" });
    await readOk(client, "backups", "abs_backups", { action: "get" });

    const missing = await call(client, "abs_items", {
      action: "get_by_id",
      params: { id: "00000000-0000-4000-8000-000000000000" },
    });
    record(
      "item unknown id",
      cleanMiss(missing) || (!missing.isError && !missing.text.includes(token)),
    );

    if (libraryId !== undefined) {
      const itemsRes = await call(client, "abs_libraries", {
        action: "get_items",
        params: { id: libraryId },
        query: { limit: "5" },
      });
      record("library items", !itemsRes.isError);
      const resultsList = Array.isArray(itemsRes.json?.["results"]) ? itemsRes.json["results"] : [];
      const bookId = firstString(resultsList, "id");
      await readOk(client, "library search", "abs_libraries", {
        action: "get_search",
        params: { id: libraryId },
        query: { q: "a", limit: "5" },
      });

      const colName = `mcp-col-${stamp}`;
      const colBody = {
        libraryId,
        name: colName,
        description: "throwaway mcp live-check",
        books: bookId ? [bookId] : [],
      };
      const collectionPreview = await call(client, "abs_collections", {
        action: "post",
        body: colBody,
      });
      record(
        "collection preview",
        collectionPreview.json?.["dry_run"] === true &&
          collectionPreview.json?.["executed"] === false,
      );
      const collection = await call(client, "abs_collections", {
        action: "post",
        body: colBody,
        confirm: true,
      });
      collectionId = firstString(collection.json, "id");
      record("collection create", !collection.isError && collectionId !== undefined);

      const plName = `mcp-pl-${stamp}`;
      const plBody = {
        libraryId,
        name: plName,
        description: "throwaway mcp live-check",
        items: [],
      };
      const playlistPreview = await call(client, "abs_playlists", {
        action: "post",
        body: plBody,
      });
      record(
        "playlist preview",
        playlistPreview.json?.["dry_run"] === true && playlistPreview.json?.["executed"] === false,
      );
      const playlist = await call(client, "abs_playlists", {
        action: "post",
        body: plBody,
        confirm: true,
      });
      playlistId = firstString(playlist.json, "id");
      record("playlist create", !playlist.isError && playlistId !== undefined);
    } else {
      record("library items", false);
      record("library search", false);
      record("collection preview", false);
      record("collection create", false);
      record("playlist preview", false);
      record("playlist create", false);
    }

    const deletePreview = await call(client, "abs_libraries", {
      action: "delete_by_id",
      params: { id: libraryId ?? "missing" },
    });
    record(
      "library delete preview only",
      deletePreview.json?.["dry_run"] === true && deletePreview.json?.["executed"] === false,
    );
  } finally {
    if (playlistId !== undefined) {
      const removed = await call(client, "abs_playlists", {
        action: "delete_by_id",
        params: { id: playlistId },
        confirm: true,
      }).catch(() => undefined);
      record("playlist delete", removed !== undefined && !removed.isError);
    }
    if (collectionId !== undefined) {
      const removed = await call(client, "abs_collections", {
        action: "delete_by_id",
        params: { id: collectionId },
        confirm: true,
      }).catch(() => undefined);
      record("collection delete", removed !== undefined && !removed.isError);
    }
    await client.close();
    await transport.close();
  }

  if (failed > 0) {
    writeLine(`FAIL  live-check  passed=${passed} failed=${failed}`);
    process.exit(1);
  }
  writeLine(`PASS  live-check  passed=${passed} failed=0`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "live-check failed";
  writeLine(`FAIL  live-check  ${redact(message).slice(0, 180)}`);
  process.exit(1);
});
