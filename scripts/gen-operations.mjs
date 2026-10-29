#!/usr/bin/env node
/**
 * Generate src/operations.ts from vendor/ApiRouter.js.
 * Run: node scripts/gen-operations.mjs
 *
 * GET is a read unless the path is in GET_SIDE_EFFECT_PATHS.
 * POST is a write unless the path is in READ_POST_PATHS.
 * PUT, PATCH, and DELETE are always writes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routerPath = join(root, "vendor", "ApiRouter.js");

export const DEFAULT_TOOLSETS = [
  "libraries",
  "items",
  "collections",
  "playlists",
  "me",
  "authors",
  "series",
  "podcasts",
  "search",
  "sessions",
  "stats",
  "tags",
  "genres",
];

export const READ_POST_PATHS = [
  "/api/items/batch/get",
  "/api/podcasts/feed",
  "/api/podcasts/opml/parse",
  "/api/filesystem/pathexists",
  "/api/validate-cron",
  "/api/authorize",
];

export const GET_SIDE_EFFECT_PATHS = [
  "/api/libraries/:id/matchall",
  "/api/podcasts/:id/checknew",
  "/api/podcasts/:id/clear-queue",
  "/api/me/progress/:id/remove-from-continue-listening",
  "/api/me/series/:id/remove-from-continue-listening",
  "/api/me/series/:id/readd-to-continue-listening",
  "/api/backups/:id/apply",
  "/api/notifications/test",
  "/api/notifications/:id/test",
];

const READ_POST_FORBIDDEN =
  /delete|remove|update|create|scan|analyze|refresh|clear|reset|login|register/i;

const EXCLUSION_TABLE = [
  {
    method: "GET",
    path: "/api/libraries/:id/download",
    reason: "Bulk zip of library items. An MCP text tool cannot carry the archive.",
  },
  {
    method: "GET",
    path: "/api/libraries/:id/opml",
    reason: "OPML file download, not a JSON catalogue.",
  },
  {
    method: "GET",
    path: "/api/items/:id/download",
    reason: "Item zip download. An MCP text tool cannot carry the archive.",
  },
  {
    method: "GET",
    path: "/api/items/:id/cover",
    reason: "Cover image bytes. Cover metadata stays on the item JSON payload.",
  },
  {
    method: "POST",
    path: "/api/items/:id/cover",
    reason: "Multipart cover upload. The tool sends JSON and cannot attach a file part.",
  },
  {
    method: "GET",
    path: "/api/items/:id/file/:fileid",
    reason: "Audio or ebook file stream. The connector does not stream media.",
  },
  {
    method: "GET",
    path: "/api/items/:id/file/:fileid/download",
    reason: "Single-file media download. An MCP text tool cannot carry the file.",
  },
  {
    method: "GET",
    path: "/api/items/:id/ebook/:fileid?",
    reason: "Ebook file bytes. The connector does not stream media.",
  },
  {
    method: "POST",
    path: "/api/items/:id/play",
    reason: "Starts a playback session. Sessions are read and close only.",
  },
  {
    method: "POST",
    path: "/api/items/:id/play/:episodeId",
    reason: "Starts an episode playback session. Sessions are read and close only.",
  },
  {
    method: "GET",
    path: "/api/authors/:id/image",
    reason: "Author image bytes. An MCP text tool cannot carry the image.",
  },
  {
    method: "POST",
    path: "/api/authors/:id/image",
    reason: "Multipart author image upload. The tool sends JSON and cannot attach a file part.",
  },
  {
    method: "GET",
    path: "/api/backups/:id/download",
    reason: "Backup zip download. An MCP text tool cannot carry the archive.",
  },
  {
    method: "POST",
    path: "/api/backups/upload",
    reason: "Multipart backup upload. The tool sends JSON and cannot attach a file part.",
  },
  {
    method: "POST",
    path: "/api/upload",
    reason: "Multipart library item upload. The tool sends JSON and cannot attach a file part.",
  },
  {
    method: "POST",
    path: "/api/podcasts/:id/download-episodes",
    reason: "Bulk episode media download onto the server. The connector does not start media downloads.",
  },
  {
    method: "POST",
    path: "/api/session/:id/sync",
    reason: "Open session progress sync. Sessions are read and close only.",
  },
  {
    method: "POST",
    path: "/api/session/local",
    reason: "Local session push. Sessions are read and close only.",
  },
  {
    method: "POST",
    path: "/api/session/local-all",
    reason: "Bulk local session push. Sessions are read and close only.",
  },
  {
    method: "POST",
    path: "/api/sessions/batch/delete",
    reason: "Bulk session delete. Close is one id only.",
  },
  {
    method: "DELETE",
    path: "/api/sessions/:id",
    reason: "Session record delete. Sessions are read and close only. Close is POST /api/session/:id/close.",
  },
];

const TOOLSET_BY_SEGMENT = {
  libraries: "libraries",
  items: "items",
  users: "users",
  collections: "collections",
  playlists: "playlists",
  me: "me",
  authors: "authors",
  series: "series",
  sessions: "sessions",
  session: "sessions",
  podcasts: "podcasts",
  search: "search",
  stats: "stats",
  tags: "tags",
  genres: "genres",
  backups: "backups",
  filesystem: "filesystem",
  notifications: "notifications",
  notificationdata: "notifications",
  emails: "emails",
  cache: "cache",
  tools: "tools",
  feeds: "feeds",
  "custom-metadata-providers": "metadata_providers",
  share: "share",
  "api-keys": "api_keys",
  tasks: "tasks",
  settings: "admin",
  "sorting-prefixes": "admin",
  authorize: "admin",
  "validate-cron": "admin",
  "auth-settings": "admin",
  watcher: "admin",
  "logger-data": "admin",
};

const QUERY_HINTS = [
  { test: /\/search$/, names: ["q", "limit"] },
  { test: /\/items$/, names: ["limit", "page", "sort", "desc", "filter", "minified", "include", "collapseseries"] },
  { test: /\/series$/, names: ["limit", "page", "sort", "filter", "minified", "include"] },
  { test: /\/collections$/, names: ["limit", "page"] },
  { test: /\/playlists$/, names: ["limit", "page"] },
  { test: /\/authors$/, names: ["limit", "page", "filter", "sort"] },
  { test: /\/sessions$/, names: ["user", "itemsPerPage", "page"] },
  { test: /listening-sessions/, names: ["itemsPerPage", "page"] },
  { test: /items-in-progress/, names: ["limit"] },
  { test: /\/personalized$/, names: ["include", "limit"] },
  { test: /\/recent-episodes$/, names: ["limit", "page"] },
  { test: /search\/covers/, names: ["title", "author", "provider"] },
  { test: /search\/books/, names: ["title", "author", "provider"] },
  { test: /search\/podcast/, names: ["term", "country"] },
  { test: /search\/authors/, names: ["q"] },
  { test: /search\/chapters/, names: ["asin"] },
  { test: /\/checknew$/, names: ["limit"] },
  { test: /search-episode/, names: ["title"] },
  { test: /include=/, names: ["include"] },
];

const BODY_HINTS = {
  "POST /api/libraries": {
    fields: [
      { name: "name", type: "string", required: true },
      { name: "folders", type: "array", required: true },
      { name: "mediaType", type: "string", required: true },
      { name: "icon", type: "string", required: false },
      { name: "provider", type: "string", required: false },
    ],
    sample: {
      name: "sample",
      folders: [{ fullPath: "/data/books" }],
      mediaType: "book",
    },
  },
  "POST /api/collections": {
    fields: [
      { name: "libraryId", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "description", type: "string", required: false },
    ],
    sample: { libraryId: "lib_sample", name: "sample" },
  },
  "POST /api/playlists": {
    fields: [
      { name: "libraryId", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "description", type: "string", required: false },
      { name: "items", type: "array", required: false },
    ],
    sample: { libraryId: "lib_sample", name: "sample" },
  },
  "PATCH /api/me/progress/:libraryItemId/:episodeId?": {
    fields: [
      { name: "currentTime", type: "number", required: false },
      { name: "duration", type: "number", required: false },
      { name: "progress", type: "number", required: false },
      { name: "isFinished", type: "boolean", required: false },
    ],
    sample: { currentTime: 16, duration: 3600, progress: 0.01 },
  },
  "POST /api/me/item/:id/bookmark": {
    fields: [
      { name: "time", type: "number", required: true },
      { name: "title", type: "string", required: false },
    ],
    sample: { time: 16, title: "sample" },
  },
  "POST /api/podcasts/feed": {
    fields: [{ name: "rssFeed", type: "string", required: true }],
    sample: { rssFeed: "https://example.com/feed.xml" },
  },
  "POST /api/filesystem/pathexists": {
    fields: [{ name: "filepath", type: "string", required: true }],
    sample: { filepath: "/data/books" },
  },
  "POST /api/validate-cron": {
    fields: [{ name: "expression", type: "string", required: true }],
    sample: { expression: "0 0 * * *" },
  },
};

/**
 * @param {string} value
 */
export function slug(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

/**
 * @param {string} path
 */
export function parseRouter(source) {
  const re = /this\.router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2(.*)/g;
  /** @type {{ method: string, path: string, handler: string }[]} */
  const rows = [];
  for (const match of source.matchAll(re)) {
    const method = match[1].toUpperCase();
    const raw = match[3];
    if (raw.startsWith("^") || raw.includes("\\")) continue;
    const tail = match[4] ?? "";
    const handlers = [...tail.matchAll(/([A-Za-z][A-Za-z0-9]*)Controller\.([A-Za-z0-9]+)/g)];
    const last = handlers.filter((item) => item[2] !== "middleware" && item[2] !== "adminMiddleware").at(-1) ??
      handlers.at(-1);
    const handler =
      last !== undefined ? `${last[1]}Controller.${last[2]}` : "MiscController.unknown";
    rows.push({ method, path: `/api${raw.startsWith("/") ? raw : `/${raw}`}`, handler });
  }
  return rows;
}

/**
 * @param {string} path
 */
export function toolsetForPath(path) {
  const parts = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const first = parts[0] ?? "admin";
  return TOOLSET_BY_SEGMENT[first] ?? "admin";
}

/**
 * @param {string} method
 * @param {string} path
 * @param {string} toolset
 */
export function actionFrom(method, path, toolset) {
  const parts = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const first = parts[0] ?? "";
  if (slug(first) === toolset) parts.shift();
  const statics = parts
    .filter((part) => !part.startsWith(":"))
    .map((part) => slug(part));
  const verb = method.toLowerCase();
  const name = [verb, ...statics].filter(Boolean).join("_");
  if (name.length === 0) return verb;
  if (name === verb && parts.some((part) => part.startsWith(":"))) return `${verb}_by_id`;
  if (name === verb) return verb;
  return name;
}

/**
 * @param {string} method
 * @param {string} path
 */
export function classifyWrite(method, path) {
  if (method === "GET") return GET_SIDE_EFFECT_PATHS.includes(path);
  if (method === "POST" && READ_POST_PATHS.includes(path)) return false;
  return true;
}

/**
 * @param {string} path
 */
function pathParamsOf(path) {
  /** @type {{ name: string, required: boolean }[]} */
  const out = [];
  for (const match of path.matchAll(/:([A-Za-z0-9_]+)(\?)?/g)) {
    const name = match[1];
    if (name === undefined) continue;
    out.push({ name, required: match[2] !== "?" });
  }
  return out;
}

/**
 * @param {string} name
 */
function sampleForParam(name) {
  const lower = name.toLowerCase();
  if (lower.includes("email")) return "user@example.com";
  if (lower === "year") return "2026";
  if (lower.includes("page")) return "0";
  if (lower.endsWith("id") || lower === "id" || lower === "fileid" || lower === "tag" || lower === "genre") {
    return "sample-id";
  }
  if (lower.includes("time")) return "16";
  return "sample";
}

/**
 * @param {string} path
 */
function queryFieldsFor(path) {
  /** @type {{ name: string, type: string, required: boolean, in: "query" }[]} */
  const fields = [];
  const seen = new Set();
  for (const hint of QUERY_HINTS) {
    if (!hint.test.test(path)) continue;
    for (const name of hint.names) {
      if (seen.has(name)) continue;
      seen.add(name);
      fields.push({ name, type: "string", required: false, in: "query" });
    }
  }
  if (/\/authors\/:id$|\/series\/:id$|\/items\/:id$|\/libraries\/:id$/.test(path)) {
    if (!seen.has("include")) {
      fields.push({ name: "include", type: "string", required: false, in: "query" });
    }
  }
  return fields;
}

/**
 * @param {string} method
 * @param {string} path
 * @param {boolean} write
 */
function warningsFor(method, path, write) {
  if (!write) return [];
  const lower = path.toLowerCase();
  /** @type {string[]} */
  const out = [];
  if (method === "DELETE") {
    out.push("This deletes data on the Audiobookshelf server. It may be irreversible.");
  }
  if (/\/scan|matchall|purge|encode-m4b|embed-metadata|remove-metadata/.test(lower)) {
    out.push("This starts a scan, match, encode, embed, purge, or other server task.");
  }
  if (/\/backups\/:id\/apply/.test(lower)) {
    out.push("This restores a backup and replaces current server data.");
  }
  if (/\/password|auth-settings|\/settings$/.test(lower) && method !== "GET") {
    out.push("This changes a password or server settings.");
  }
  if (/\/users/.test(lower) && method !== "GET") {
    out.push("This creates, updates, or deletes a user.");
  }
  if (/\/api-keys/.test(lower) && method !== "GET") {
    out.push("This creates, updates, or revokes an API key. A new key is shown only once.");
  }
  if (/\/emails/.test(lower) && method !== "GET") {
    out.push("This sends email or changes email settings.");
  }
  if (method === "GET") {
    out.push("This GET changes server state. It is gated like a write.");
  }
  return [...new Set(out)];
}

/**
 * @param {string} method
 * @param {string} path
 * @param {readonly string[]} warnings
 */
function isDestructive(method, path, warnings) {
  if (method === "DELETE") return true;
  const lower = path.toLowerCase();
  if (/\/apply|\/purge|\/password|\/users|\/api-keys/.test(lower) && method !== "GET") return true;
  return warnings.some((line) => /deletes|restores a backup|API key|password/.test(line));
}

/**
 * @param {string} handler
 * @param {string} method
 * @param {string} path
 */
function schemaIdFor(handler, method, path) {
  if (handler === "ApiKeyController.create") return "apiKeyCreated";
  if (handler === "ApiKeyController.getAll") return "apiKeyList";
  if (handler.startsWith("LibraryController.findAll")) return "libraryList";
  if (handler.startsWith("LibraryController.findOne") || handler.startsWith("LibraryController.create")) {
    return "library";
  }
  if (handler.includes("getLibraryItems") || handler.includes("batchGet")) return "libraryItemList";
  if (handler.includes("LibraryItemController.findOne")) return "libraryItem";
  if (handler.includes("CollectionController")) return "collection";
  if (handler.includes("PlaylistController")) return "playlist";
  if (handler.includes("MeController.getCurrentUser") || handler.includes("UserController")) return "user";
  if (handler.includes("SessionController") || handler.includes("getSessions") || handler.includes("getOpen")) {
    return path.includes("/session/") && method === "GET" ? "session" : "sessionList";
  }
  if (handler.includes("MediaProgress") || path.includes("/progress")) return "progress";
  if (handler.includes("Bookmark")) return "bookmark";
  if (handler.includes("AuthorController")) return "author";
  if (handler.includes("SeriesController") || path.includes("/series")) return "series";
  if (handler.includes("getPodcastFeed")) return "podcastFeed";
  if (handler.includes("PodcastController") && path.includes("/episode")) return "podcastEpisode";
  if (handler.includes("SearchController") || path.includes("/search")) return "searchResults";
  if (handler.includes("StatsController") || path.includes("/stats")) return "stats";
  if (handler.includes("updateServerSettings") || path.includes("/settings") || path.includes("auth-settings")) {
    return "settings";
  }
  if (handler.includes("getTasks") || path === "/api/tasks") return "taskList";
  if (method === "DELETE") return "ok";
  return "jsonEnvelope";
}

/**
 * @param {string} source
 */
export function planOperations(source) {
  const routerRows = parseRouter(source);
  const routerKeys = routerRows.map((row) => `${row.method} ${row.path}`);
  const routerSet = new Set(routerKeys);
  if (new Set(routerKeys).size !== routerKeys.length) {
    throw new Error("ApiRouter.js has duplicate method+path rows.");
  }

  for (const path of READ_POST_PATHS) {
    if (!routerSet.has(`POST ${path}`)) throw new Error(`READ_POST path is not a POST in the router: ${path}`);
    if (READ_POST_FORBIDDEN.test(path)) throw new Error(`READ_POST path contains a mutation word: ${path}`);
  }
  for (const path of GET_SIDE_EFFECT_PATHS) {
    if (!routerSet.has(`GET ${path}`)) throw new Error(`GET side-effect path missing: ${path}`);
  }

  const exclusionKeys = new Set();
  for (const row of EXCLUSION_TABLE) {
    const key = `${row.method} ${row.path}`;
    if (!routerSet.has(key)) throw new Error(`Exclusion is not in the router: ${key}`);
    if (row.reason.trim().length < 20) throw new Error(`Exclusion reason too short: ${key}`);
    exclusionKeys.add(key);
  }

  /** @type {object[]} */
  const rows = [];
  const seen = new Map();

  for (const route of routerRows) {
    const key = `${route.method} ${route.path}`;
    const excluded = EXCLUSION_TABLE.find(
      (row) => row.method === route.method && row.path === route.path,
    );
    if (excluded !== undefined) continue;

    const toolset = toolsetForPath(route.path);
    let action = actionFrom(route.method, route.path, toolset);
    if (action === "help") action = `${action}_op`;
    let unique = `${toolset}::${action}`;
    if (seen.has(unique)) {
      const params = pathParamsOf(route.path).map((param) => slug(param.name));
      const withParams = params.length > 0 ? `${action}_${params.join("_")}` : `${action}_${route.method.toLowerCase()}`;
      action = seen.has(`${toolset}::${withParams}`) ? `${withParams}_${rows.length}` : withParams;
      unique = `${toolset}::${action}`;
    }
    seen.set(unique, key);

    const pathParams = pathParamsOf(route.path);
    /** @type {Record<string, string>} */
    const sampleParams = {};
    /** @type {{ name: string, type: string, required: boolean, in: string }[]} */
    const fields = [];
    for (const param of pathParams) {
      if (param.required) sampleParams[param.name] = sampleForParam(param.name);
      fields.push({ name: param.name, type: "string", required: param.required, in: "path" });
    }
    const queryFields = queryFieldsFor(route.path);
    fields.push(...queryFields);
    /** @type {Record<string, string>} */
    const sampleQuery = {};
    for (const field of queryFields) {
      if (field.required) sampleQuery[field.name] = sampleForParam(field.name);
    }

    const write = classifyWrite(route.method, route.path);
    const warnings = warningsFor(route.method, route.path, write);
    const bodyHint = BODY_HINTS[key];
    const bodyFields = bodyHint?.fields ?? [];
    const sampleBody = bodyHint?.sample;
    const summary = `${route.method} ${route.path}`.slice(0, 240);
    const schemaId = schemaIdFor(route.handler, route.method, route.path);

    rows.push({
      method: route.method,
      path: route.path,
      operationId: key,
      action,
      tool: `abs_${toolset}`,
      toolset,
      tag: toolset,
      handler: route.handler,
      write,
      destructive: isDestructive(route.method, route.path, warnings),
      revealSecret: route.handler === "ApiKeyController.create",
      kind: route.method === "DELETE" ? "empty" : "json",
      schemaId,
      summary,
      pathParams: pathParams.map((param) => param.name),
      queryParams: queryFields.map((field) => field.name),
      fields,
      bodyFields,
      warnings,
      sampleParams,
      sampleQuery,
      sampleBody,
    });
  }

  rows.sort((a, b) => {
    const tool = a.tool.localeCompare(b.tool);
    if (tool !== 0) return tool;
    return a.action.localeCompare(b.action);
  });
  const exclusions = [...EXCLUSION_TABLE].sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
  );

  if (rows.length + exclusions.length !== routerRows.length) {
    throw new Error(
      `Coverage mismatch: ${rows.length} ops + ${exclusions.length} exclusions !== ${routerRows.length} router rows.`,
    );
  }

  const toolsets = [...new Set(rows.map((row) => row.toolset))].sort();
  /** @type {Record<string, { operations: number, tags: string[] }>} */
  const counts = {};
  for (const toolset of toolsets) {
    const subset = rows.filter((row) => row.toolset === toolset);
    counts[toolset] = {
      operations: subset.length,
      tags: [...new Set(subset.map((row) => row.tag))].sort(),
    };
  }
  for (const name of DEFAULT_TOOLSETS) {
    if (!toolsets.includes(name)) throw new Error(`Default toolset has no operations: ${name}`);
  }
  return { rows, exclusions, counts, toolsets, routerRows };
}

/**
 * @param {unknown} value
 */
function ts(value) {
  return JSON.stringify(value);
}

/**
 * @param {object} row
 */
function emitRow(row) {
  const options = [
    `action: ${ts(row.action)}`,
    `toolset: ${ts(row.toolset)}`,
    `tag: ${ts(row.tag)}`,
    `handler: ${ts(row.handler)}`,
    `operationId: ${ts(row.operationId)}`,
    `write: ${row.write}`,
    `destructive: ${row.destructive}`,
    `revealSecret: ${row.revealSecret}`,
    `kind: ${ts(row.kind)}`,
    `schemaId: ${ts(row.schemaId)}`,
    `summary: ${ts(row.summary)}`,
    `pathParams: ${ts(row.pathParams)}`,
    `queryParams: ${ts(row.queryParams)}`,
    `fields: ${ts(row.fields)}`,
    `bodyFields: ${ts(row.bodyFields)}`,
    `warnings: ${ts(row.warnings)}`,
    `sampleParams: ${ts(row.sampleParams)}`,
    `sampleQuery: ${ts(row.sampleQuery)}`,
  ];
  if (row.sampleBody !== undefined) options.push(`sampleBody: ${ts(row.sampleBody)}`);
  return `  row(${ts(row.method)}, ${ts(row.path)}, ${ts(row.tool)}, {\n    ${options.join(",\n    ")},\n  })`;
}

function emitFile(plan) {
  const header = `/** Generated by scripts/gen-operations.mjs from vendor/ApiRouter.js. Do not edit by hand. */

import { ConnectorError } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type ResponseKind = "json" | "empty";
export type SchemaId =
  | "jsonEnvelope"
  | "ok"
  | "library"
  | "libraryList"
  | "libraryItem"
  | "libraryItemList"
  | "collection"
  | "playlist"
  | "user"
  | "session"
  | "sessionList"
  | "progress"
  | "bookmark"
  | "author"
  | "series"
  | "podcastEpisode"
  | "podcastFeed"
  | "searchResults"
  | "stats"
  | "settings"
  | "taskList"
  | "apiKeyCreated"
  | "apiKeyList";

export interface FieldSchema {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly in?: "path" | "query";
}

export interface Operation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly tool: string;
  readonly action: string;
  readonly toolset: string;
  readonly tag: string;
  readonly handler: string;
  readonly operationId: string;
  readonly write: boolean;
  readonly destructive: boolean;
  readonly revealSecret: boolean;
  readonly kind: ResponseKind;
  readonly schemaId: SchemaId;
  readonly summary: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly fields: readonly FieldSchema[];
  readonly bodyFields: readonly FieldSchema[];
  readonly warnings: readonly string[];
  readonly sampleParams: Readonly<Record<string, string>>;
  readonly sampleQuery: Readonly<Record<string, string>>;
  readonly sampleBody?: unknown;
}

export interface ExcludedOperation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly reason: string;
}

function row(
  method: HttpMethod,
  path: string,
  tool: string,
  options: {
    action: string;
    toolset: string;
    tag: string;
    handler: string;
    operationId: string;
    write: boolean;
    destructive: boolean;
    revealSecret: boolean;
    kind: ResponseKind;
    schemaId: SchemaId;
    summary: string;
    pathParams: readonly string[];
    queryParams: readonly string[];
    fields: readonly FieldSchema[];
    bodyFields: readonly FieldSchema[];
    warnings: readonly string[];
    sampleParams: Readonly<Record<string, string>>;
    sampleQuery: Readonly<Record<string, string>>;
    sampleBody?: unknown;
  },
): Operation {
  return {
    method,
    path,
    tool,
    action: options.action,
    toolset: options.toolset,
    tag: options.tag,
    handler: options.handler,
    operationId: options.operationId,
    write: options.write,
    destructive: options.destructive,
    revealSecret: options.revealSecret,
    kind: options.kind,
    schemaId: options.schemaId,
    summary: options.summary,
    pathParams: options.pathParams,
    queryParams: options.queryParams,
    fields: options.fields,
    bodyFields: options.bodyFields,
    warnings: options.warnings,
    sampleParams: options.sampleParams,
    sampleQuery: options.sampleQuery,
    ...(options.sampleBody !== undefined ? { sampleBody: options.sampleBody } : {}),
  };
}

export const DEFAULT_TOOLSETS = ${ts(DEFAULT_TOOLSETS)} as const;

export const ALL_TOOLSETS = ${ts(plan.toolsets)} as const;

export const READ_POST_PATHS = ${ts(READ_POST_PATHS)} as const;

export const GET_SIDE_EFFECT_PATHS = ${ts(GET_SIDE_EFFECT_PATHS)} as const;

export const TOOLSET_COUNTS: Readonly<
  Record<string, { readonly operations: number; readonly tags: readonly string[] }>
> = ${ts(plan.counts)};

export const EXCLUSIONS: readonly ExcludedOperation[] = ${ts(plan.exclusions)};

export const OPERATIONS: readonly Operation[] = [
${plan.rows.map((row) => emitRow(row)).join(",\n")},
];

export function toolNames(): string[] {
  return [...new Set(OPERATIONS.map((operation) => operation.tool))].sort();
}

export function operationsForTool(name: string): Operation[] {
  return OPERATIONS.filter((operation) => operation.tool === name);
}

export function toolIsWrite(name: string): boolean {
  return OPERATIONS.some((operation) => operation.tool === name && operation.write);
}

export function routerKeys(): string[] {
  return OPERATIONS.map((operation) => \`\${operation.method} \${operation.path}\`).sort();
}

export function requireOp(tool: string, action: string): Operation {
  const found = OPERATIONS.find((operation) => operation.tool === tool && operation.action === action);
  if (found === undefined) {
    throw new ConnectorError("input", \`Unknown Audiobookshelf operation \${tool} \${action}.\`);
  }
  return found;
}

export function parseToolsets(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_TOOLSETS];
  const trimmed = raw.trim();
  if (trimmed === "all") return [...ALL_TOOLSETS];
  const wanted = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const allowed = new Set<string>(ALL_TOOLSETS);
  const unknown = wanted.filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new ConnectorError("config", "Unknown ABS_TOOLSETS value.");
  }
  return [...new Set(wanted)];
}

export function toolsForToolsets(enabled: readonly string[]): string[] {
  const allow = new Set(enabled);
  return toolNames().filter((name) => {
    const operation = OPERATIONS.find((row) => row.tool === name);
    return operation !== undefined && allow.has(operation.toolset);
  });
}
`;
  return header;
}

function main() {
  const source = readFileSync(routerPath, "utf8");
  const plan = planOperations(source);
  writeFileSync(join(root, "src", "operations.ts"), emitFile(plan));
  process.stderr.write(
    `wrote ${plan.rows.length} operations, ${plan.exclusions.length} exclusions, ${plan.toolsets.length} toolsets\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
