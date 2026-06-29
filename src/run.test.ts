import { describe, it, expect, vi, afterEach } from "vitest";
import { forecast, forecastEpics } from "./run";
import type { EpicCount } from "./jira";

afterEach(() => vi.restoreAllMocks());

describe("forecast", () => {
  it("how-many: fixed random gives deterministic items and percentiles", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const r = forecast({ mode: "howmany", throughput: [5], runs: 100, days: 3, json: false, tsv: false, forecastFrom: today });
    expect(r.unit).toBe("items");
    expect(r.mean).toBe(15);
    expect(r.percentiles.p50).toBe(15);
    expect(r.min).toBe(15);
    expect(r.max).toBe(15);
  });

  it("how-many: probability vs --tickets reference", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const r = forecast({ mode: "howmany", throughput: [5], runs: 100, days: 3, tickets: 15, json: false, tsv: false, forecastFrom: today });
    expect(r.probability?.reference).toBe(15);
    expect(r.probability?.pct).toBe(100);
    expect(r.probability?.verdict).toBe("On Track");
  });

  it("how-many: headcount applies capacity ratio (5 * 0.5 * 3 = 7.5)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const r = forecast({
      mode: "howmany", throughput: [5], runs: 10, days: 3,
      headcount: { data: 5, forecast: 2.5 }, json: false, tsv: false, forecastFrom: today,
    });
    expect(r.capRatio).toBeCloseTo(0.5);
    expect(r.mean).toBeCloseTo(7.5);
  });

  it("when: deterministic days and probability within budget", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const r = forecast({ mode: "when", throughput: [5], runs: 100, tickets: 50, days: 10, json: false, tsv: false, forecastFrom: today });
    expect(r.unit).toBe("days");
    expect(r.mean).toBe(10);
    expect(r.probability?.reference).toBe(10);
    expect(r.probability?.pct).toBe(100);
  });

  it("omits probability when no secondary arg is present", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const r = forecast({ mode: "howmany", throughput: [5], runs: 10, days: 3, json: false, tsv: false, forecastFrom: today });
    expect(r.probability).toBeUndefined();
  });
});

describe("forecastEpics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns one EpicResult per epic", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [5], runs: 100, json: false, tsv: false, showJql: false, forecastFrom: today };
    const counts: EpicCount[] = [{ key: "A-1", count: 10 }, { key: "A-2", count: 20 }];
    const r = forecastEpics(cfg, counts);
    expect(r.epics).toHaveLength(2);
    expect(r.epics[0].key).toBe("A-1");
    expect(r.epics[1].key).toBe("A-2");
  });

  it("globalPercentiles matches the last epic's cumulativePercentiles", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [5], runs: 100, json: false, tsv: false, showJql: false, forecastFrom: today };
    const counts: EpicCount[] = [{ key: "A-1", count: 10 }, { key: "A-2", count: 20 }];
    const r = forecastEpics(cfg, counts);
    expect(r.globalPercentiles.p50).toBe(r.epics[1].cumulativePercentiles.p50);
    expect(r.globalPercentiles.p85).toBe(r.epics[1].cumulativePercentiles.p85);
  });

  it("deterministic: [5] throughput, [10, 20] tickets, random=0 → epic0 dur=2, epic1 dur=4, global=6", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [5], runs: 10, json: false, tsv: false, showJql: false, forecastFrom: today };
    const counts: EpicCount[] = [{ key: "E-1", count: 10 }, { key: "E-2", count: 20 }];
    const r = forecastEpics(cfg, counts);
    expect(r.epics[0].durationPercentiles.p50).toBe(2);
    expect(r.epics[0].cumulativePercentiles.p50).toBe(2);
    expect(r.epics[1].durationPercentiles.p50).toBe(4);
    expect(r.epics[1].cumulativePercentiles.p50).toBe(6);
    expect(r.globalPercentiles.p50).toBe(6);
  });

  it("cumulative days for epic N > epic N-1 across all runs", () => {
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [3, 5, 7], runs: 200, json: false, tsv: false, showJql: false, forecastFrom: today };
    const counts: EpicCount[] = [{ key: "E-1", count: 15 }, { key: "E-2", count: 25 }, { key: "E-3", count: 10 }];
    const r = forecastEpics(cfg, counts);
    expect(r.epics[1].cumulativePercentiles.p50).toBeGreaterThan(r.epics[0].cumulativePercentiles.p50);
    expect(r.epics[2].cumulativePercentiles.p50).toBeGreaterThan(r.epics[1].cumulativePercentiles.p50);
  });

  it("EpicResult.buffer is 0 when buffer is absent from input", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [5], runs: 10, json: false, tsv: false, showJql: false, forecastFrom: today };
    const counts = [{ key: "E-1", count: 10 }];
    const r = forecastEpics(cfg, counts);
    expect(r.epics[0].buffer).toBe(0);
  });

  it("EpicResult.buffer matches the input buffer", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [5], runs: 10, json: false, tsv: false, showJql: false, forecastFrom: today };
    const counts = [{ key: "E-1", count: 5, buffer: 5 }];
    const r = forecastEpics(cfg, counts);
    expect(r.epics[0].buffer).toBe(5);
  });

  it("uses count+buffer as effective ticket count in simulation", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = { mode: "when" as const, throughput: [5], runs: 10, json: false, tsv: false, showJql: false, forecastFrom: today };
    const countsWithBuffer = [{ key: "E-1", count: 5, buffer: 5 }];
    const countsBaseline   = [{ key: "E-1", count: 10 }];
    const rBuf  = forecastEpics(cfg, countsWithBuffer);
    const rBase = forecastEpics(cfg, countsBaseline);
    expect(rBuf.epics[0].durationPercentiles.p50).toBe(rBase.epics[0].durationPercentiles.p50);
  });

  it("applies headcount capacity ratio", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const today = new Date().toISOString().slice(0, 10);
    const cfg = {
      mode: "when" as const, throughput: [5], runs: 10, json: false, tsv: false, showJql: false, forecastFrom: today,
      headcount: { data: 5, forecast: 2.5 }, // ratio = 0.5 → effective 2.5/day
    };
    const counts: EpicCount[] = [{ key: "E-1", count: 10 }]; // 10 / 2.5 = 4 days
    const r = forecastEpics(cfg, counts);
    expect(r.capRatio).toBeCloseTo(0.5);
    expect(r.epics[0].durationPercentiles.p50).toBe(4);
  });
});
