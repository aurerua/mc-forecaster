import type { ForecastResult, EpicForecastResult } from "./run";
import { bold, dim, green, yellow, red } from "./ansi";

export function formatJson(r: ForecastResult): string {
  return JSON.stringify(r, null, 2);
}

const CONFIDENCE = [
  ["p50", 50],
  ["p70", 70],
  ["p85", 85],
  ["p95", 95],
] as const;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function capRatioLabel(
  capRatio: number,
  headcount?: { data: number; forecast: number },
  headcountSource?: "workday"
): string {
  if (capRatio === 1) return "";
  const suffix = headcountSource === "workday" ? " avg available" : "";
  const raw = headcount ? ` (${fmt(headcount.data)}→${fmt(headcount.forecast)}${suffix})` : "";
  return `   Capacity ratio: ${capRatio.toFixed(3)}${raw}`;
}

export function addWorkingDays(start: Date, days: number): Date {
  const d = new Date(start);
  let remaining = Math.round(days);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

function addCalendarDays(start: Date, days: number): Date {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d;
}

function projectDate(start: Date, days: number, excludeWeekends: boolean): Date {
  return excludeWeekends ? addWorkingDays(start, days) : addCalendarDays(start, days);
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function formatHuman(r: ForecastResult, throughputLabel?: string, runDate?: string): string {
  const lines: string[] = [];
  const modeLabel = r.mode === "howmany"
    ? `How many (items in ${r.days ?? "N"} days)`
    : "When (days to finish N items)";

  lines.push(bold(`Monte Carlo forecast — ${modeLabel}`));
  lines.push(
    `Runs: ${r.runs.toLocaleString()}` +
    (runDate ? `   Run: ${runDate}` : "") +
    capRatioLabel(r.capRatio, r.headcount, r.headcountSource)
  );
  if (throughputLabel) lines.push(`Throughput: ${throughputLabel}`);
  lines.push("");
  lines.push(bold("Percentiles:"));
  for (const [key, conf] of CONFIDENCE) {
    lines.push(`  P${conf}: ${fmt(r.percentiles[key])} ${r.unit}   ${dim(`(${conf}% confidence)`)}`);
  }
  lines.push("");
  lines.push(`Mean: ${fmt(r.mean)} ${r.unit}   Min: ${fmt(r.min)}   Max: ${fmt(r.max)}`);

  if (r.probability) {
    const p = r.probability;
    const refUnit = r.mode === "howmany" ? "items" : "days";
    const comp = r.mode === "howmany" ? "≥" : "≤";
    const verdictFn = p.verdict === "On Track" ? green : p.verdict === "At Risk" ? yellow : red;
    lines.push("");
    lines.push(
      `Probability of ${comp} ${p.reference} ${refUnit}: ${p.pct.toFixed(1)}%  ${verdictFn(`[${p.verdict}]`)}`
    );
  }

  return lines.join("\n");
}

export function formatEpicsHuman(
  r: EpicForecastResult,
  throughputLabel?: string,
  startDate?: Date,
  excludeWeekends = false,
  runDate?: string
): string {
  const start = startDate ?? new Date();
  const lines: string[] = [];

  lines.push(bold("Monte Carlo forecast — When (sequential epics)"));
  lines.push(
    `Runs: ${r.runs.toLocaleString()}` +
    (runDate ? `   Run: ${runDate}` : "") +
    capRatioLabel(r.capRatio, r.headcount, r.headcountSource)
  );
  if (throughputLabel) lines.push(`Throughput: ${throughputLabel}`);
  lines.push("");

  if (r.epics.length > 1) {
    lines.push(bold("=== Global (all epics combined) ==="));
    for (const [key, conf] of CONFIDENCE) {
      const days = r.globalPercentiles[key];
      const date = toYMD(projectDate(start, days, excludeWeekends));
      lines.push(`  P${conf}: ${fmt(days)} days  →  ${date}   ${dim(`(${conf}% confidence)`)}`);
    }
  }

  for (const epic of r.epics) {
    lines.push("");
    lines.push(bold(`=== ${epic.key} (${epic.count} open tickets${epic.buffer > 0 ? ` + ${epic.buffer}` : ""}) ===`));
    for (const [key, conf] of CONFIDENCE) {
      const dur = epic.durationPercentiles[key];
      const cum = epic.cumulativePercentiles[key];
      const date = toYMD(projectDate(start, cum, excludeWeekends));
      lines.push(`  P${conf}: ${fmt(dur)} days   cumulative: ${date}   ${dim(`(${conf}% confidence)`)}`);
    }
  }

  return lines.join("\n");
}

function toDDMMYYYY(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
}

export function formatEpicsTsv(
  r: EpicForecastResult,
  runDate: string,
  forecastStart: Date,
  excludeWeekends: boolean
): string {
  const date = toDDMMYYYY(runDate);
  const finish = (cumDays: number) => toYMD(projectDate(forecastStart, cumDays, excludeWeekends));
  return r.epics.map((epic) => [
      date,
      epic.key,
      epic.count,
      epic.buffer,
      epic.durationPercentiles.p95,
      epic.durationPercentiles.p85,
      epic.durationPercentiles.p70,
      epic.durationPercentiles.p50,
      finish(epic.cumulativePercentiles.p95),
      finish(epic.cumulativePercentiles.p85),
      finish(epic.cumulativePercentiles.p70),
    finish(epic.cumulativePercentiles.p50),
  ].join("\t")).join("\n");
}
