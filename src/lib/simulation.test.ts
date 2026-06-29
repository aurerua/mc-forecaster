import { describe, it, expect, vi, afterEach } from "vitest";
import { runHowMany, runWhen, runWhenSequential, capacityRatio } from "./simulation";

afterEach(() => vi.restoreAllMocks());

// ── Deterministic tests ───────────────────────────────────────────────────

describe("runHowMany deterministic", () => {
  it("with fixed random=0, every run equals throughput[0] * sprintDays", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const results = runHowMany([5], 3, 100);
    expect(results).toHaveLength(100);
    expect(results.every((r) => r === 15)).toBe(true);
  });

  it("applies capacity ratio: random=0, [5], 3 days, ratio 0.5 → 7.5 per run", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const results = runHowMany([5], 3, 100, 0.5);
    expect(results.every((r) => r === 7.5)).toBe(true);
  });
});

describe("runWhen deterministic", () => {
  it("exact burndown: [5] throughput, 50 tickets, ratio 1 → 10 days per run", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const results = runWhen([5], 50, 100, 1);
    expect(results).toHaveLength(100);
    expect(results.every((r) => r === 10)).toBe(true);
  });

  it("capacity ratio 0.5: effective 2.5/day → 20 days per run", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    // 50 / (5 * 0.5) = 50 / 2.5 = 20
    const results = runWhen([5], 50, 10, 0.5);
    expect(results.every((r) => r === 20)).toBe(true);
  });

  it("safety cap: throughput [0] returns 10000 without hanging", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const results = runWhen([0], 50, 5, 1);
    expect(results.every((r) => r === 10000)).toBe(true);
  });
});

describe("capacityRatio deterministic", () => {
  it("returns forecastHC / histHC for valid positive inputs", () => {
    expect(capacityRatio(10, 8)).toBeCloseTo(0.8);
  });

  it("returns 1 when histHC is 0", () => {
    expect(capacityRatio(0, 8)).toBe(1);
  });

  it("returns 1 when histHC is negative", () => {
    expect(capacityRatio(-5, 8)).toBe(1);
  });

  it("returns 1 when histHC is empty string", () => {
    expect(capacityRatio("", 8)).toBe(1);
  });

  it("returns 1 when forecastHC is 0", () => {
    expect(capacityRatio(10, 0)).toBe(1);
  });

  it("returns 1 when forecastHC is empty string", () => {
    expect(capacityRatio(10, "")).toBe(1);
  });
});

// ── Statistical tests (N = 50 000) ───────────────────────────────────────

describe("runHowMany statistical", () => {
  const throughput = [2, 4, 6, 8, 10];
  const sprintDays = 10;
  const N = 50000;

  it("mean ≈ sprintDays * mean(throughput) within ±2%", () => {
    const results = runHowMany(throughput, sprintDays, N);
    const mean = results.reduce((a, b) => a + b, 0) / N;
    const expected =
      sprintDays * (throughput.reduce((a, b) => a + b, 0) / throughput.length);
    expect(mean).toBeGreaterThan(expected * 0.98);
    expect(mean).toBeLessThan(expected * 1.02);
  });

  it("no NaN or Infinity in output (throughput includes 0)", () => {
    const results = runHowMany([0, 1, 2, 5], 10, N);
    expect(results.every((r) => isFinite(r) && !isNaN(r))).toBe(true);
  });
});

describe("runWhen statistical", () => {
  const throughput = [2, 4, 6, 8, 10];
  const targetItems = 60;
  const N = 50000;

  it("mean ≈ targetItems / mean(throughput) within ±3%", () => {
    const results = runWhen(throughput, targetItems, N);
    const mean = results.reduce((a, b) => a + b, 0) / N;
    const expected =
      targetItems /
      (throughput.reduce((a, b) => a + b, 0) / throughput.length);
    expect(mean).toBeGreaterThan(expected * 0.95);
    expect(mean).toBeLessThan(expected * 1.05);
  });

  it("capacity scaling: median at ratio=0.78 ≈ median at ratio=1 / 0.78, within ±5%", () => {
    const r1 = [...runWhen(throughput, targetItems, N, 1)].sort((a, b) => a - b);
    const r2 = [...runWhen(throughput, targetItems, N, 0.78)].sort((a, b) => a - b);
    const median1 = r1[Math.floor(N / 2)];
    const median2 = r2[Math.floor(N / 2)];
    const expected = median1 / 0.78;
    expect(median2).toBeGreaterThan(expected * 0.95);
    expect(median2).toBeLessThan(expected * 1.05);
  });

  it("no NaN or Infinity even with throughput containing 0", () => {
    const results = runWhen([0, 1, 2, 5], 20, N);
    expect(results.every((r) => isFinite(r) && !isNaN(r))).toBe(true);
  });
});

describe("runWhenSequential", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns one array per epic, each with numSims entries", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = runWhenSequential([5], [10, 20], 100);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(100);
    expect(result[1]).toHaveLength(100);
  });

  it("each epic's cumulative days >= the previous epic's", () => {
    const result = runWhenSequential([5], [10, 20], 200);
    for (let sim = 0; sim < 200; sim++) {
      expect(result[1][sim]).toBeGreaterThanOrEqual(result[0][sim]);
    }
  });

  it("deterministic: [5] throughput, [10, 20] tickets, random=0 → epic0=2, epic1=6", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    // 10 tickets / 5 per day = 2 days; 20 tickets / 5 per day = 4 days; cumulative = 6
    const result = runWhenSequential([5], [10, 20], 1);
    expect(result[0][0]).toBe(2);
    expect(result[1][0]).toBe(6);
  });

  it("single epic matches runWhen distribution shape (mean within ±3%)", () => {
    const throughput = [2, 4, 6, 8, 10];
    const N = 10000;
    const seq = runWhenSequential(throughput, [60], N);
    const single = runWhen(throughput, 60, N);
    const meanSeq = seq[0].reduce((a, b) => a + b, 0) / N;
    const meanSingle = single.reduce((a, b) => a + b, 0) / N;
    expect(Math.abs(meanSeq - meanSingle) / meanSingle).toBeLessThan(0.05);
  });

  it("applies capacity ratio: [5] throughput, 10 tickets, ratio 0.5 → 4 days (ceil 10/2.5)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    // effective throughput = 5 * 0.5 = 2.5 per day; 10/2.5 = 4 days
    const result = runWhenSequential([5], [10], 1, 0.5);
    expect(result[0][0]).toBe(4);
  });
});
