#!/usr/bin/env bun
/**
 * Manual smoke test — not in the test suite.
 * Reads real credentials from ~/.config/mcf/env and fetches a small date range.
 *
 * Usage:
 *   bun mc-forecaster/scripts/smoke-jira.ts [PROJECT] [FROM] [TO]
 *
 * Example:
 *   bun mc-forecaster/scripts/smoke-jira.ts PROJ 2026-06-01 2026-06-19
 */
import { fetchThroughput, buildJql } from "../src/jira";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function loadEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  try {
    const content = readFileSync(join(homedir(), ".config", "mcf", "env"), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      base[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch { /* absent */ }
  return { ...base, ...(process.env as Record<string, string>) };
}

const env = loadEnv();

const cfg = {
  baseUrl: env.JIRA_URL ?? "",
  email: env.JIRA_EMAIL ?? "",
  token: env.JIRA_TOKEN ?? "",
  project: process.argv[2] ?? env.MCF_DEFAULT_PROJECT ?? "",
  from: process.argv[3] ?? "2026-06-01",
  to: process.argv[4] ?? "2026-06-19",
  types: (env.MCF_JIRA_TYPES ?? "Bug,Story,Task").split(",").map((s) => s.trim()),
  excludeResolutions: (env.MCF_SMOKE_EXCLUDE_RESOLUTIONS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  excludeWeekends: false,
  noCache: true,
};

if (!cfg.baseUrl || !cfg.email || !cfg.token) {
  console.error("Error: JIRA_URL, JIRA_EMAIL, JIRA_TOKEN must be set in ~/.config/mcf/env");
  process.exit(1);
}
if (!cfg.project) {
  console.error("Error: provide a project key as the first argument or set MCF_DEFAULT_PROJECT in ~/.config/mcf/env");
  process.exit(1);
}

console.log(`Project : ${cfg.project}`);
console.log(`Range   : ${cfg.from} – ${cfg.to}`);
console.log(`JQL     : ${buildJql(cfg)}`);
console.log("");

const { throughput: counts } = await fetchThroughput(cfg);

console.log(`Daily counts (${counts.length} samples):`);
console.log(counts.join(", "));
console.log("");
console.log(`Total tickets : ${counts.reduce((a, b) => a + b, 0)}`);
console.log(`Mean/day      : ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);
console.log(`Non-zero days : ${counts.filter((n) => n > 0).length}`);
