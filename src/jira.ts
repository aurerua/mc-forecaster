import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { JiraConn } from "./args";

export interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
  project: string;
  from: string;         // YYYY-MM-DD
  to: string;           // YYYY-MM-DD
  types: string[];
  excludeResolutions: string[];
  excludeWeekends: boolean;
  noCache: boolean;
  cacheDir?: string;    // defaults to ~/.cache/mcf; override in tests
}

export interface JiraIssue {
  key: string;
  date: string; // YYYY-MM-DD
  type?: string;
  resolution?: string;
}

// --- Date utilities ---

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + "T12:00:00Z").getUTCDay();
  return day === 0 || day === 6;
}

function enumerateDays(from: string, to: string, excludeWeekends: boolean): string[] {
  const days: string[] = [];
  const end = new Date(to + "T12:00:00Z");
  const cur = new Date(from + "T12:00:00Z");
  while (cur <= end) {
    const d = cur.toISOString().slice(0, 10);
    if (!excludeWeekends || !isWeekend(d)) days.push(d);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

export function bucketByDay(
  issues: JiraIssue[],
  from: string,
  to: string,
  excludeWeekends: boolean
): number[] {
  const days = enumerateDays(from, to, excludeWeekends);
  const counts = new Map<string, number>(days.map((d) => [d, 0]));
  for (const issue of issues) {
    if (counts.has(issue.date)) counts.set(issue.date, counts.get(issue.date)! + 1);
  }
  return days.map((d) => counts.get(d)!);
}

// --- Cache ---

function cacheKey(cfg: JiraConfig): string {
  const payload = JSON.stringify({
    project: cfg.project,
    from: cfg.from,
    to: cfg.to,
    types: [...cfg.types].sort(),
    excludeResolutions: [...cfg.excludeResolutions].sort(),
    excludeWeekends: cfg.excludeWeekends,
  });
  return createHash("sha256").update(payload).digest("hex");
}

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function shouldUseCache(cfg: JiraConfig): boolean {
  return cfg.to < todayYMD();
}

function cacheFilePath(cfg: JiraConfig): string {
  const dir = cfg.cacheDir ?? join(homedir(), ".cache", "mcf");
  return join(dir, `${cacheKey(cfg)}.json`);
}

function readCache(cfg: JiraConfig): JiraIssue[] | null {
  try {
    const raw = JSON.parse(readFileSync(cacheFilePath(cfg), "utf8"));
    return raw.issues as JiraIssue[];
  } catch {
    return null;
  }
}

function writeCache(cfg: JiraConfig, issues: JiraIssue[]): void {
  const dir = cfg.cacheDir ?? join(homedir(), ".cache", "mcf");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    cacheFilePath(cfg),
    JSON.stringify(
      {
        params: {
          project: cfg.project, from: cfg.from, to: cfg.to,
          types: cfg.types, excludeResolutions: cfg.excludeResolutions,
          excludeWeekends: cfg.excludeWeekends,
        },
        issues,
      },
      null,
      2
    )
  );
}

function clearCache(cfg: JiraConfig): void {
  try {
    rmSync(cacheFilePath(cfg));
  } catch {
    // Missing cache file is expected on first run.
  }
}

// --- HTTP ---

export function buildJql(cfg: JiraConfig): string {
  const cats = cfg.types.map((c) => `"${c}"`).join(", ");
  const resolutionClause =
    cfg.excludeResolutions.length > 0
      ? ` AND resolution NOT IN (${cfg.excludeResolutions.map((r) => `"${r}"`).join(", ")})`
      : "";
  return (
    `project = "${cfg.project}"` +
    ` AND statusCategory = Done` +
    resolutionClause +
    ` AND statusCategoryChangedDate >= "${cfg.from}"` +
    ` AND statusCategoryChangedDate <= "${cfg.to}"` +
    ` AND issuetype in (${cats})` +
    ` ORDER BY statusCategoryChangedDate ASC`
  );
}

export interface EpicCount {
  key: string;
  count: number;
}

export function buildEpicJql(epicKey: string, epicTypes: string[]): string {
  const cats = epicTypes.map((c) => `"${c}"`).join(", ");
  return (
    `parent = "${epicKey}"` +
    ` AND statusCategory != Done` +
    ` AND issuetype in (${cats})`
  );
}

const EPIC_CACHE_TTL_MS = 5 * 60 * 1000;

function epicCacheKey(epicKey: string, types: string[]): string {
  const payload = JSON.stringify({ epic: epicKey, types: [...types].sort() });
  return createHash("sha256").update(payload).digest("hex");
}

function epicCacheFilePath(cfg: JiraConfig, epicKey: string, types: string[]): string {
  const dir = cfg.cacheDir ?? join(homedir(), ".cache", "mcf");
  return join(dir, `epic-${epicCacheKey(epicKey, types)}.json`);
}

function readEpicCache(cfg: JiraConfig, epicKey: string, types: string[]): number | null {
  try {
    const raw = JSON.parse(readFileSync(epicCacheFilePath(cfg, epicKey, types), "utf8"));
    if (Date.now() - raw.cachedAt > EPIC_CACHE_TTL_MS) return null;
    return raw.count as number;
  } catch {
    return null;
  }
}

function writeEpicCache(cfg: JiraConfig, epicKey: string, types: string[], count: number): void {
  const dir = cfg.cacheDir ?? join(homedir(), ".cache", "mcf");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    epicCacheFilePath(cfg, epicKey, types),
    JSON.stringify({ epicKey, count, cachedAt: Date.now() })
  );
}

async function fetchOneEpicCount(cfg: JiraConfig, epicKey: string, types: string[]): Promise<number> {
  const url = `${cfg.baseUrl}/rest/api/3/search/jql`;
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  let count = 0;
  let nextPageToken: string | undefined;

  while (true) {
    const bodyData: Record<string, unknown> = {
      jql: buildEpicJql(epicKey, types),
      fields: ["key"],
      maxResults: 100,
    };
    if (nextPageToken) bodyData.nextPageToken = nextPageToken;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyData),
    });
    if (resp.status === 401) throw new Error("Jira auth failed — check JIRA_EMAIL and JIRA_TOKEN in ~/.config/mcf/env");
    if (resp.status === 400) {
      const body = await resp.json().catch(() => ({})) as any;
      throw new Error(`Jira query error: ${body.errorMessages?.[0] ?? body.message ?? "Bad request"}`);
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Jira error ${resp.status}: ${text}`);
    }
    const body = await resp.json() as any;
    count += (body.issues as any[]).length;
    if (body.isLast || !body.nextPageToken) break;
    nextPageToken = body.nextPageToken;
  }

  return count;
}

export async function fetchEpicCounts(
  cfg: JiraConfig,
  epicKeys: string[],
  epicTypes: string[]
): Promise<EpicCount[]> {
  const cats = epicTypes;
  return Promise.all(
    epicKeys.map(async (key) => {
      if (!cfg.noCache) {
        const cached = readEpicCache(cfg, key, cats);
        if (cached !== null) return { key, count: cached };
      }
      const count = await fetchOneEpicCount(cfg, key, cats);
      if (!cfg.noCache) writeEpicCache(cfg, key, cats, count);
      return { key, count };
    })
  );
}

async function fetchPage(
  cfg: JiraConfig,
  nextPageToken?: string
): Promise<{ issues: JiraIssue[]; nextPageToken?: string; isLast: boolean }> {
  const url = `${cfg.baseUrl}/rest/api/3/search/jql`;
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");

  const bodyData: Record<string, unknown> = {
    jql: buildJql(cfg),
    fields: ["key", "statuscategorychangedate", "issuetype", "resolution"],
    maxResults: 100,
  };
  if (nextPageToken) bodyData.nextPageToken = nextPageToken;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyData),
  });

  if (resp.status === 401) {
    throw new Error("Jira auth failed — check JIRA_EMAIL and JIRA_TOKEN in ~/.config/mcf/env");
  }
  if (resp.status === 400) {
    const body = await resp.json().catch(() => ({})) as any;
    const msg = body.errorMessages?.[0] ?? body.message ?? "Bad request";
    throw new Error(`Jira query error: ${msg}`);
  }
  if (resp.status === 429) {
    const err = new Error("Jira rate limit hit — try again shortly") as any;
    err.status = 429;
    throw err;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Jira error ${resp.status}: ${text}`);
  }

  const body = await resp.json() as any;
  const issues: JiraIssue[] = (body.issues as any[])
    .map((i) => ({
      key: i.key,
      date: (i.fields?.statuscategorychangedate ?? "").slice(0, 10),
      type: i.fields?.issuetype?.name as string | undefined,
      resolution: i.fields?.resolution?.name as string | undefined,
    }))
    .filter((i) => i.date.length === 10);

  return { issues, nextPageToken: body.nextPageToken, isLast: body.isLast ?? true };
}

async function fetchAllIssues(cfg: JiraConfig): Promise<JiraIssue[]> {
  const all: JiraIssue[] = [];
  let nextPageToken: string | undefined;

  while (true) {
    let result: { issues: JiraIssue[]; nextPageToken?: string; isLast: boolean };
    try {
      result = await fetchPage(cfg, nextPageToken);
    } catch (err: any) {
      if (err.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        result = await fetchPage(cfg, nextPageToken);
      } else {
        throw err;
      }
    }
    all.push(...result.issues);
    if (result.isLast || !result.nextPageToken) break;
    nextPageToken = result.nextPageToken;
  }

  return all;
}

// --- Public API ---

/** Fetch the project's issue type names (excluding subtask types), for guiding
 *  the user when MCF_JIRA_TYPES is unset. */
export async function fetchProjectIssueTypes(conn: JiraConn): Promise<string[]> {
  const url = `${conn.baseUrl}/rest/api/3/project/${encodeURIComponent(conn.project)}`;
  const auth = Buffer.from(`${conn.email}:${conn.token}`).toString("base64");
  const resp = await fetch(url, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (resp.status === 401) throw new Error("Jira auth failed — check JIRA_EMAIL and JIRA_TOKEN in ~/.config/mcf/env");
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Jira error ${resp.status}: ${text}`);
  }
  const body = await resp.json() as any;
  const names = ((body.issueTypes ?? []) as any[])
    .filter((t) => !t.subtask)
    .map((t) => t.name as string)
    .filter(Boolean);
  return [...new Set(names)].sort();
}

export function countJiraTypes(issues: JiraIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    if (i.type) counts[i.type] = (counts[i.type] ?? 0) + 1;
  }
  return counts;
}

export function countResolutions(issues: JiraIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of issues) {
    if (i.resolution) counts[i.resolution] = (counts[i.resolution] ?? 0) + 1;
  }
  return counts;
}

export async function fetchThroughput(cfg: JiraConfig): Promise<{ throughput: number[]; categories: Record<string, number>; resolutions: Record<string, number> }> {
  const cacheableRange = shouldUseCache(cfg);

  if (cacheableRange && cfg.noCache) {
    // Force refresh behavior: drop stale entry before re-fetching from Jira.
    clearCache(cfg);
  }

  if (cacheableRange && !cfg.noCache) {
    const cached = readCache(cfg);
    if (cached) return { throughput: bucketByDay(cached, cfg.from, cfg.to, cfg.excludeWeekends), categories: countJiraTypes(cached), resolutions: countResolutions(cached) };
  }

  const issues = await fetchAllIssues(cfg);

  if (cacheableRange) writeCache(cfg, issues);

  return { throughput: bucketByDay(issues, cfg.from, cfg.to, cfg.excludeWeekends), categories: countJiraTypes(issues), resolutions: countResolutions(issues) };
}
