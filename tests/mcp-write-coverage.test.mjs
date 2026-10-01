import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MCP_STAFF_WRITE_TOOLS } from "../lib/mcp-write-contracts.ts";
import { MCP_STAFF_ROUTE_COVERAGE } from "../lib/mcp-write-coverage.ts";

const apiRoot = fileURLToPath(new URL("../app/api/", import.meta.url));

async function routeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory()
    ? routeFiles(join(directory, entry.name))
    : entry.name === "route.ts" ? [join(directory, entry.name)] : []));
  return nested.flat();
}

test("each state-changing staff route has a named MCP tool or a documented internal exception", async () => {
  const knownTools = new Set(MCP_STAFF_WRITE_TOOLS.map((tool) => tool.name));
  const coveredTools = new Set();
  const discovered = new Set();
  for (const file of await routeFiles(apiRoot)) {
    const source = await readFile(file, "utf8");
    const key = relative(apiRoot, file).split(sep).join("/").replace(/\/route\.ts$/, "");
    if (!/export async function (POST|PATCH|PUT|DELETE)\b/.test(source) && !["tiktok/authorize", "tiktok-ads/authorize"].includes(key)) continue;
    discovered.add(key);
    const coverage = MCP_STAFF_ROUTE_COVERAGE[key];
    assert.ok(coverage, `Classify ${key} before adding another staff mutation`);
    assert.ok("tools" in coverage || "internalReason" in coverage, `${key} needs tools or an internal reason`);
    if ("tools" in coverage) for (const name of coverage.tools) {
      assert.ok(knownTools.has(name), `${key} refers to missing MCP tool ${name}`);
      coveredTools.add(name);
    }
  }
  assert.deepEqual([...Object.keys(MCP_STAFF_ROUTE_COVERAGE)].sort(), [...discovered].sort());
  assert.deepEqual([...coveredTools].sort(), [...knownTools].sort());
});
