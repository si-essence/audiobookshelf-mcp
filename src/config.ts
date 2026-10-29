import { z } from "zod";
import { brandBaseUrl, brandSecret, type BaseUrl, type Secret } from "./brand.js";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { parseToolsets } from "./operations.js";
import { fixedError } from "./zod-messages.js";

const invalid = fixedError("invalid");

const EnvSchema = z.object({
  ABS_API_TOKEN: z
    .string({ error: invalid })
    .trim()
    .min(8, { error: invalid })
    .max(512, { error: invalid }),
  ABS_BASE_URL: z.url({ error: invalid }),
  ABS_ALLOW_WRITES: z.string({ error: invalid }).optional(),
  ABS_TOOLSETS: z.string({ error: invalid }).optional(),
  ABS_PER_MINUTE: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  ABS_TIMEOUT_MS: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  ABS_CONTACT: z
    .string({ error: invalid })
    .trim()
    .min(1, { error: invalid })
    .max(120, { error: invalid })
    .optional(),
  MCP_TRANSPORT: z.enum(["stdio", "http"], { error: invalid }).optional(),
  PORT: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  ABS_CACHE_TTL_SEC: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
});

export interface Config {
  token: Secret;
  baseUrl: BaseUrl;
  allowWrites: boolean;
  toolsets: readonly string[];
  perMinute: number;
  timeoutMs: number;
  contact: string;
  transport: "stdio" | "http";
  port: number;
  cacheTtlSec: number;
  userAgent: string;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function blank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return blank(env[name]);
}

function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length === 0 ? "(root)" : issue.path.map((part) => String(part)).join(".");
      return `${path} (${issue.code})`;
    })
    .join("; ");
}

function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (raw === undefined) return fallback;
  const parsed = z.number().int().min(min).max(max).safeParse(Number(raw));
  if (!parsed.success) {
    throw new ConnectorError("config", `Invalid environment: ${field} (out_of_range).`);
  }
  return parsed.data;
}

function userAgentFor(contact: string): string {
  const clean = contact
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
  return `${CONNECTOR_NAME}/${CONNECTOR_VERSION} (${clean.length > 0 ? clean : "contact@example.com"})`;
}

function normalizeBaseUrl(value: string): BaseUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("config", "Invalid environment: ABS_BASE_URL (invalid_url).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConnectorError("config", "Invalid environment: ABS_BASE_URL (invalid_url).");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConnectorError("config", "Invalid environment: ABS_BASE_URL (userinfo).");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ConnectorError("config", "Invalid environment: ABS_BASE_URL (query_or_hash).");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ConnectorError("config", "Invalid environment: ABS_BASE_URL (path).");
  }
  return brandBaseUrl(value.replace(/\/+$/, ""));
}

export function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[]): Config {
  const urlRaw = read(env, "ABS_BASE_URL");
  if (urlRaw === undefined) {
    throw new ConnectorError(
      "config",
      "Invalid environment: ABS_BASE_URL (required). Set it to your self-hosted Audiobookshelf origin, for example http://127.0.0.1:13378.",
    );
  }
  const tokenRaw = read(env, "ABS_API_TOKEN");
  if (tokenRaw === undefined) {
    throw new ConnectorError(
      "config",
      "Invalid environment: ABS_API_TOKEN (required). Set a Bearer token from your Audiobookshelf user.",
    );
  }

  const parsed = EnvSchema.safeParse({
    ABS_API_TOKEN: tokenRaw,
    ABS_BASE_URL: urlRaw,
    ABS_ALLOW_WRITES: read(env, "ABS_ALLOW_WRITES"),
    ABS_TOOLSETS: read(env, "ABS_TOOLSETS"),
    ABS_PER_MINUTE: read(env, "ABS_PER_MINUTE"),
    ABS_TIMEOUT_MS: read(env, "ABS_TIMEOUT_MS"),
    ABS_CONTACT: read(env, "ABS_CONTACT"),
    MCP_TRANSPORT: read(env, "MCP_TRANSPORT"),
    PORT: read(env, "PORT"),
    ABS_CACHE_TTL_SEC: read(env, "ABS_CACHE_TTL_SEC"),
  });
  if (!parsed.success) {
    throw new ConnectorError("config", `Invalid environment: ${issueSummary(parsed.error)}.`);
  }

  const data = parsed.data;
  const token = brandSecret(data.ABS_API_TOKEN);
  const baseUrl = normalizeBaseUrl(data.ABS_BASE_URL);
  const contact = data.ABS_CONTACT ?? "contact@example.com";
  if (hasControlChar(contact)) {
    throw new ConnectorError("config", "Invalid environment: ABS_CONTACT (control_character).");
  }
  const userAgent = userAgentFor(contact);
  if (baseUrl.includes(token)) {
    throw new ConnectorError("config", "Invalid environment: ABS_BASE_URL (contains_secret).");
  }
  if (contact.includes(token) || userAgent.includes(token)) {
    throw new ConnectorError("config", "Invalid environment: ABS_CONTACT (contains_secret).");
  }

  const transport = argv.includes("--http") ? "http" : (data.MCP_TRANSPORT ?? "stdio");
  return {
    token,
    baseUrl,
    allowWrites: data.ABS_ALLOW_WRITES === "true",
    toolsets: parseToolsets(data.ABS_TOOLSETS),
    perMinute: boundedInt(data.ABS_PER_MINUTE, 30, 1, 300, "ABS_PER_MINUTE"),
    timeoutMs: boundedInt(data.ABS_TIMEOUT_MS, 20_000, 1000, 120_000, "ABS_TIMEOUT_MS"),
    contact,
    transport,
    port: boundedInt(data.PORT, 3000, 1, 65535, "PORT"),
    cacheTtlSec: boundedInt(data.ABS_CACHE_TTL_SEC, 60, 0, 3600, "ABS_CACHE_TTL_SEC"),
    userAgent,
  };
}
