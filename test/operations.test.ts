import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_TOOLSETS,
  DEFAULT_TOOLSETS,
  EXCLUSIONS,
  GET_SIDE_EFFECT_PATHS,
  OPERATIONS,
  READ_POST_PATHS,
  parseToolsets,
  toolNames,
} from "../src/operations.js";

function planned(): { actions: string[]; exclusions: string[]; router: string[] } {
  const routerFile = fileURLToPath(new URL("../vendor/ApiRouter.js", import.meta.url));
  if (!existsSync(routerFile)) {
    // Upstream router is GPL-3.0 and not shipped; fall back to the committed route snapshot.
    const snapshot = fileURLToPath(new URL("./fixtures/router-plan.json", import.meta.url));
    return JSON.parse(readFileSync(snapshot, "utf8")) as {
      actions: string[];
      exclusions: string[];
      router: string[];
    };
  }
  const script = [
    'import { planOperations } from "./scripts/gen-operations.mjs";',
    'import { readFileSync } from "node:fs";',
    'const source = readFileSync("./vendor/ApiRouter.js", "utf8");',
    "const plan = planOperations(source);",
    "process.stdout.write(JSON.stringify({",
    '  actions: plan.rows.map((row) => row.tool + ":" + row.action),',
    '  exclusions: plan.exclusions.map((row) => row.method + " " + row.path),',
    '  router: plan.routerRows.map((row) => row.method + " " + row.path),',
    "}));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "generator failed");
  }
  return JSON.parse(result.stdout) as { actions: string[]; exclusions: string[]; router: string[] };
}

describe("ApiRouter coverage", () => {
  const generated = planned();
  const registry = OPERATIONS.map((operation) => `${operation.method} ${operation.path}`);
  const excluded = EXCLUSIONS.map((operation) => `${operation.method} ${operation.path}`);

  it("matches the router in both directions, with every exclusion reasoned", () => {
    expect(new Set(registry).size).toBe(registry.length);
    expect(new Set(excluded).size).toBe(excluded.length);
    const routerSet = new Set(generated.router);
    for (const key of registry) {
      expect(routerSet.has(key), key).toBe(true);
      expect(excluded).not.toContain(key);
    }
    for (const key of excluded) {
      expect(routerSet.has(key), key).toBe(true);
    }
    for (const key of generated.router) {
      const covered = registry.includes(key);
      const skipped = excluded.includes(key);
      expect(covered !== skipped, key).toBe(true);
    }
    expect(registry.length + excluded.length).toBe(generated.router.length);
    expect(registry.length).toBe(181);
    expect(excluded.length).toBe(21);
    for (const row of EXCLUSIONS) {
      expect(row.reason.trim().length).toBeGreaterThan(20);
    }
  });

  it("matches the generator output", () => {
    const committed = OPERATIONS.map((operation) => `${operation.tool}:${operation.action}`);
    expect(committed).toEqual(generated.actions);
    expect(excluded.sort()).toEqual([...generated.exclusions].sort());
  });

  it("keeps admin and users out of the default toolsets", () => {
    expect(DEFAULT_TOOLSETS).not.toContain("admin");
    expect(DEFAULT_TOOLSETS).not.toContain("users");
    expect(ALL_TOOLSETS).toContain("admin");
    expect(ALL_TOOLSETS).toContain("users");
    expect(parseToolsets(undefined)).toEqual([...DEFAULT_TOOLSETS]);
    expect(toolNames().some((name) => name === "abs_libraries")).toBe(true);
  });

  it("classifies side-effect GETs as writes and allow-listed POSTs as reads", () => {
    for (const path of GET_SIDE_EFFECT_PATHS) {
      const operation = OPERATIONS.find((row) => row.method === "GET" && row.path === path);
      expect(operation?.write, path).toBe(true);
    }
    for (const path of READ_POST_PATHS) {
      const operation = OPERATIONS.find((row) => row.method === "POST" && row.path === path);
      expect(operation?.write, path).toBe(false);
    }
  });

  it("keeps session coverage to read and close", () => {
    const sessionOps = OPERATIONS.filter((operation) => operation.toolset === "sessions");
    const keys = sessionOps.map((operation) => `${operation.method} ${operation.path}`).sort();
    expect(keys).toEqual(
      [
        "GET /api/session/:id",
        "GET /api/sessions",
        "GET /api/sessions/open",
        "POST /api/session/:id/close",
      ].sort(),
    );
  });
});
