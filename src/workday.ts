import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// --- Types ---

export interface WorkdayConfig {
  jsonLink: string;
  user: string;
  password: string;
  excludeWorkers: string[];
  noCache: boolean;
  cacheDir?: string;
  fields: {
    entries: string;
    worker: string;
    dateFrom: string;
    dateTo: string;
  };
  dateParams: {
    from: string;
    to: string;
  };
}

export interface WorkdayEntry {
  worker: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

// --- Pure helpers ---

export function buildUrl(
  baseUrl: string,
  from: string,
  to: string,
  paramFrom: string,
  paramTo: string
): string {
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}${paramFrom}=${from}&${paramTo}=${to}&format=json`;
}

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

function teamSizeOn(date: string, base: number, joiners: string[], leavers: string[]): number {
  let size = base;
  for (const j of joiners) if (j <= date) size++;
  for (const l of leavers) if (l <= date) size--;
  return size;
}

export function avgAvailable(
  vacations: WorkdayEntry[],
  baseTeamSize: number,
  joiners: string[],
  leavers: string[],
  from: string,
  to: string,
  excludeWeekends: boolean
): number {
  const days = enumerateDays(from, to, excludeWeekends);
  if (days.length === 0) return teamSizeOn(from, baseTeamSize, joiners, leavers);

  let total = 0;
  for (const day of days) {
    const size = teamSizeOn(day, baseTeamSize, joiners, leavers);
    const absentWorkers = new Set(
      vacations
        .filter((v) => v.from <= day && v.to >= day)
        .map((v) => v.worker)
    ).size;
    total += Math.max(0, size - absentWorkers);
  }
  return total / days.length;
}

export function addDaysToYMD(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addWorkingDaysToYMD(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// --- Cache ---

function todayYMD(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(user: string, from: string, to: string, excludeWorkers: string[]): string {
  const payload = JSON.stringify({ user, from, to, excludeWorkers: [...excludeWorkers].sort() });
  return createHash("sha256").update(payload).digest("hex");
}

function cacheFilePath(cfg: WorkdayConfig, from: string, to: string): string {
  const dir = cfg.cacheDir ?? join(homedir(), ".cache", "mcf");
  return join(dir, `wd-${cacheKey(cfg.user, from, to, cfg.excludeWorkers)}.json`);
}

function readCache(cfg: WorkdayConfig, from: string, to: string): WorkdayEntry[] | null {
  try {
    const raw = JSON.parse(readFileSync(cacheFilePath(cfg, from, to), "utf8"));
    if (!raw.cachedDate) return raw.entries as WorkdayEntry[];
    if (raw.cachedDate === todayYMD()) return raw.entries as WorkdayEntry[];
    return null;
  } catch {
    return null;
  }
}

function writeCache(
  cfg: WorkdayConfig,
  from: string,
  to: string,
  entries: WorkdayEntry[],
  permanent: boolean
): void {
  const dir = cfg.cacheDir ?? join(homedir(), ".cache", "mcf");
  mkdirSync(dir, { recursive: true });
  const payload = permanent ? { entries } : { cachedDate: todayYMD(), entries };
  writeFileSync(cacheFilePath(cfg, from, to), JSON.stringify(payload, null, 2));
}

function clearCacheFile(cfg: WorkdayConfig, from: string, to: string): void {
  try {
    rmSync(cacheFilePath(cfg, from, to));
  } catch {
    // Missing cache file is expected on first run.
  }
}

// --- HTTP ---

function isHistorical(to: string): boolean {
  return to < todayYMD();
}

export async function fetchReportJson(
  jsonLink: string,
  user: string,
  password: string,
  from: string,
  to: string,
  paramFrom: string,
  paramTo: string
): Promise<Record<string, unknown>> {
  const url = buildUrl(jsonLink, from, to, paramFrom, paramTo);
  const credentials = Buffer.from(`${user}:${password}`).toString("base64");
  const resp = await fetch(url, { headers: { Authorization: `Basic ${credentials}` } });
  if (resp.status === 401) {
    throw new Error("Workday auth failed — check WD_USER and WD_PASSWORD in ~/.config/mcf/env");
  }
  if (!resp.ok) {
    throw new Error(`Workday request failed: ${resp.status}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

export async function fetchVacations(
  cfg: WorkdayConfig,
  from: string,
  to: string
): Promise<WorkdayEntry[]> {
  const permanent = isHistorical(to);

  if (cfg.noCache) {
    clearCacheFile(cfg, from, to);
  } else {
    const cached = readCache(cfg, from, to);
    if (cached) return cached;
  }

  const { fields, dateParams } = cfg;

  const url = buildUrl(cfg.jsonLink, from, to, dateParams.from, dateParams.to);
  const credentials = Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64");
  const resp = await fetch(url, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (resp.status === 401) {
    throw new Error("Workday auth failed — check WD_USER and WD_PASSWORD in ~/.config/mcf/env");
  }
  if (!resp.ok) {
    throw new Error(`Workday request failed: ${resp.status}`);
  }

  const json = await resp.json() as Record<string, unknown>;
  const excludeSet = new Set(cfg.excludeWorkers);
  const rawEntries = (json[fields.entries] as Array<Record<string, string>>) ?? [];
  const entries: WorkdayEntry[] = rawEntries
    .filter((e) => !excludeSet.has(e[fields.worker]))
    .map((e) => ({ worker: e[fields.worker], from: e[fields.dateFrom], to: e[fields.dateTo] }));

  writeCache(cfg, from, to, entries, permanent);
  return entries;
}
