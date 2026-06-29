import { describe, it, expect } from "vitest";
import { formatHuman, formatJson, addWorkingDays, formatEpicsHuman, formatEpicsTsv } from "./format";
import type { ForecastResult, EpicForecastResult } from "./run";

const result: ForecastResult = {
  mode: "howmany",
  unit: "items",
  runs: 10000,
  capRatio: 1,
  percentiles: { p50: 60, p70: 55, p85: 50, p95: 45 },
  mean: 60,
  min: 30,
  max: 90,
  probability: { reference: 50, pct: 92.3, verdict: "On Track" },
};

describe("formatJson", () => {
  it("emits valid JSON that round-trips the result", () => {
    expect(JSON.parse(formatJson(result))).toEqual(result);
  });
});

describe("formatHuman", () => {
  it("renders all four percentiles", () => {
    const out = formatHuman(result);
    expect(out).toContain("P50");
    expect(out).toContain("P70");
    expect(out).toContain("P85");
    expect(out).toContain("P95");
  });

  it("renders the probability percentage and verdict", () => {
    expect(formatHuman(result)).toMatch(/92\.3%.*On Track/s);
  });

  it("omits the probability line when probability is absent", () => {
    const out = formatHuman({ ...result, probability: undefined });
    expect(out).not.toMatch(/Probability/);
  });

  it("renders the throughput label when provided", () => {
    const out = formatHuman(result, "fetched from Jira (PROJ, 2026-06-06 – 2026-06-19, 33 tickets across 14 days)");
    expect(out).toContain("Throughput: fetched from Jira");
  });

  it("omits the throughput line when label is absent", () => {
    expect(formatHuman(result)).not.toContain("Throughput:");
  });
});

describe("addWorkingDays", () => {
  it("adds 0 days returns same date (normalized to midnight UTC)", () => {
    const start = new Date("2026-06-22T00:00:00Z"); // Monday
    const result = addWorkingDays(start, 0);
    expect(result.toISOString().slice(0, 10)).toBe("2026-06-22");
  });

  it("adds 5 working days from Monday → next Monday", () => {
    const start = new Date("2026-06-22T00:00:00Z"); // Monday 2026-06-22
    const result = addWorkingDays(start, 5);
    expect(result.toISOString().slice(0, 10)).toBe("2026-06-29"); // next Monday
  });

  it("skips Saturday and Sunday", () => {
    const start = new Date("2026-06-22T00:00:00Z"); // Monday
    const result = addWorkingDays(start, 1);
    expect(result.toISOString().slice(0, 10)).toBe("2026-06-23"); // Tuesday
    const startFriday = new Date("2026-06-26T00:00:00Z"); // Friday
    const afterFriday = addWorkingDays(startFriday, 1);
    expect(afterFriday.toISOString().slice(0, 10)).toBe("2026-06-29"); // Monday
  });

  it("adds 10 working days (2 weeks)", () => {
    const start = new Date("2026-06-22T00:00:00Z"); // Monday
    const result = addWorkingDays(start, 10);
    expect(result.toISOString().slice(0, 10)).toBe("2026-07-06"); // Monday 2 weeks later
  });
});

const epicResult: EpicForecastResult = {
  runs: 1000,
  capRatio: 1,
  globalPercentiles: { p50: 10, p70: 12, p85: 14, p95: 16 },
  epics: [
    {
      key: "PROJ-1",
      count: 5,
      buffer: 0,
      durationPercentiles: { p50: 4, p70: 5, p85: 6, p95: 7 },
      cumulativePercentiles: { p50: 4, p70: 5, p85: 6, p95: 7 },
    },
    {
      key: "PROJ-2",
      count: 8,
      buffer: 0,
      durationPercentiles: { p50: 6, p70: 7, p85: 8, p95: 9 },
      cumulativePercentiles: { p50: 10, p70: 12, p85: 14, p95: 16 },
    },
  ],
};

// Fixed Monday start for date assertions
const fixedStart = new Date("2026-06-22T00:00:00Z");

describe("formatEpicsHuman", () => {
  it("includes the header line with 'sequential epics'", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart);
    expect(out).toContain("sequential epics");
  });

  it("renders global section with all four percentiles and dates", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart);
    expect(out).toContain("Global");
    expect(out).toContain("P50");
    expect(out).toContain("P95");
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("renders each epic key with open ticket count", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart);
    expect(out).toContain("PROJ-1");
    expect(out).toContain("5 open tickets");
    expect(out).toContain("PROJ-2");
    expect(out).toContain("8 open tickets");
  });

  it("shows individual duration and cumulative date per epic per percentile", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart);
    // PROJ-1 P50: 4 days individual, cumulative same since it's first
    expect(out).toMatch(/PROJ-1[\s\S]*4 days/);
    // PROJ-2 P50: cumulative = 10 calendar days from 2026-06-22 (excludeWeekends=false)
    expect(out).toContain("2026-07-02");
  });

  it("uses working days for date projection when excludeWeekends=true", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart, true);
    // PROJ-2 P50: cumulative = 10 working days from 2026-06-22 (Monday) = 2026-07-06
    expect(out).toContain("2026-07-06");
    expect(out).not.toContain("2026-07-02");
  });

  it("renders throughput label when provided", () => {
    const out = formatEpicsHuman(epicResult, "fetched from Jira (MYPROJ)", fixedStart);
    expect(out).toContain("Throughput: fetched from Jira (MYPROJ)");
  });

  it("omits throughput line when label is absent", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart);
    expect(out).not.toContain("Throughput:");
  });

  it("does not show buffer suffix when buffer is 0", () => {
    const out = formatEpicsHuman(epicResult, undefined, fixedStart);
    expect(out).not.toMatch(/\+ \d/);
  });

  it("omits global section when there is only one epic", () => {
    const singleEpicResult: EpicForecastResult = {
      ...epicResult,
      epics: [epicResult.epics[0]],
    };
    const out = formatEpicsHuman(singleEpicResult, undefined, fixedStart);
    expect(out).not.toContain("Global");
    expect(out).toContain("PROJ-1");
  });

  it("shows '+ N' suffix on ticket count when buffer > 0", () => {
    const resultWithBuffer: EpicForecastResult = {
      ...epicResult,
      epics: [
        { ...epicResult.epics[0], buffer: 3 },
        { ...epicResult.epics[1], buffer: 0 },
      ],
    };
    const out = formatEpicsHuman(resultWithBuffer, undefined, fixedStart);
    expect(out).toContain("5 open tickets + 3");
    expect(out).not.toMatch(/8 open tickets \+ \d/);
  });
});

describe("formatEpicsTsv", () => {
  it("emits one row per epic (no header)", () => {
    const out = formatEpicsTsv(epicResult, "2026-06-22", fixedStart, false);
    expect(out.split("\n")).toHaveLength(2); // 2 epics, no header
  });

  it("formats run date as DD.MM.YYYY in the Date column", () => {
    const out = formatEpicsTsv(epicResult, "2026-06-22", fixedStart, false);
    expect(out.split("\n")[0].split("\t")[0]).toBe("22.06.2026");
  });

  it("places epic key, open count, and buffer in the correct columns", () => {
    const resultWithBuffer: EpicForecastResult = {
      ...epicResult,
      epics: [{ ...epicResult.epics[0], buffer: 3 }],
    };
    const out = formatEpicsTsv(resultWithBuffer, "2026-06-22", fixedStart, false);
    const cols = out.split("\n")[0].split("\t");
    expect(cols[1]).toBe("PROJ-1");
    expect(cols[2]).toBe("5");
    expect(cols[3]).toBe("3");
  });

  it("uses durationPercentiles for the days columns (P95→P50 order)", () => {
    const out = formatEpicsTsv(epicResult, "2026-06-22", fixedStart, false);
    const cols = out.split("\n")[0].split("\t"); // PROJ-1
    expect(cols[4]).toBe("7");  // P95 days = durationPercentiles.p95
    expect(cols[5]).toBe("6");  // P85 days
    expect(cols[6]).toBe("5");  // P70 days
    expect(cols[7]).toBe("4");  // P50 days
  });

  it("uses cumulativePercentiles projected to calendar dates for finish columns", () => {
    const out = formatEpicsTsv(epicResult, "2026-06-22", fixedStart, false);
    const cols = out.split("\n")[1].split("\t"); // PROJ-2
    // cumulativePercentiles: {p95:16, p85:14, p70:12, p50:10} calendar days from 2026-06-22
    expect(cols[8]).toBe("2026-07-08");  // P95 finish: +16 days
    expect(cols[9]).toBe("2026-07-06");  // P85 finish: +14 days
    expect(cols[10]).toBe("2026-07-04"); // P70 finish: +12 days
    expect(cols[11]).toBe("2026-07-02"); // P50 finish: +10 days
  });

  it("uses working days for finish dates when excludeWeekends is true", () => {
    const out = formatEpicsTsv(epicResult, "2026-06-22", fixedStart, true);
    const cols = out.split("\n")[1].split("\t"); // PROJ-2
    // P50: 10 working days from 2026-06-22 (Monday) = 2026-07-06
    expect(cols[11]).toBe("2026-07-06");
    // P95: 16 working days from 2026-06-22 = 2026-07-14
    expect(cols[8]).toBe("2026-07-14");
  });
});
