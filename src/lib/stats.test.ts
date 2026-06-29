import { describe, it, expect } from "vitest";
import { calcPercentiles } from "./stats";

const sorted100 = Array.from({ length: 100 }, (_, i) => i + 1);

describe("calcPercentiles — howmany mode (right-scan)", () => {
  it("returns correct index-based values for all four percentiles", () => {
    const pcts = calcPercentiles(sorted100, "howmany");
    // p50: scan p = 100-50 = 50 → idx = ceil(50/100*100)-1 = 49 → value = 50
    expect(pcts.p50).toBe(50);
    // p70: scan p = 100-70 = 30 → idx = ceil(30/100*100)-1 = 29 → value = 30
    expect(pcts.p70).toBe(30);
    // p85: scan p = 100-85 = 15 → idx = ceil(15/100*100)-1 = 14 → value = 15
    expect(pcts.p85).toBe(15);
    // p95: scan p = 100-95 = 5  → idx = ceil(5/100*100)-1 = 4  → value = 5
    expect(pcts.p95).toBe(5);
  });

  it("monotonicity: p50 >= p70 >= p85 >= p95", () => {
    const pcts = calcPercentiles(sorted100, "howmany");
    expect(pcts.p50).toBeGreaterThanOrEqual(pcts.p70);
    expect(pcts.p70).toBeGreaterThanOrEqual(pcts.p85);
    expect(pcts.p85).toBeGreaterThanOrEqual(pcts.p95);
  });
});

describe("calcPercentiles — when mode (left-scan)", () => {
  it("returns correct index-based values for all four percentiles", () => {
    const pcts = calcPercentiles(sorted100, "when");
    // p50: scan p = 50 → idx = ceil(50/100*100)-1 = 49 → value = 50
    expect(pcts.p50).toBe(50);
    // p70: scan p = 70 → idx = ceil(70/100*100)-1 = 69 → value = 70
    expect(pcts.p70).toBe(70);
    // p85: scan p = 85 → idx = ceil(85/100*100)-1 = 84 → value = 85
    expect(pcts.p85).toBe(85);
    // p95: scan p = 95 → idx = ceil(95/100*100)-1 = 94 → value = 95
    expect(pcts.p95).toBe(95);
  });

  it("monotonicity: p50 <= p70 <= p85 <= p95", () => {
    const pcts = calcPercentiles(sorted100, "when");
    expect(pcts.p50).toBeLessThanOrEqual(pcts.p70);
    expect(pcts.p70).toBeLessThanOrEqual(pcts.p85);
    expect(pcts.p85).toBeLessThanOrEqual(pcts.p95);
  });
});

describe("calcPercentiles statistical", () => {
  const N = 50000;
  const randomData = Array.from({ length: N }, () =>
    Math.floor(Math.random() * 100) + 1
  );
  const sortedData = [...randomData].sort((a, b) => a - b);

  it("percentile ordering always holds on real random data (howmany)", () => {
    const pcts = calcPercentiles(sortedData, "howmany");
    expect(pcts.p50).toBeGreaterThanOrEqual(pcts.p70);
    expect(pcts.p70).toBeGreaterThanOrEqual(pcts.p85);
    expect(pcts.p85).toBeGreaterThanOrEqual(pcts.p95);
  });

  it("percentile ordering always holds on real random data (when)", () => {
    const pcts = calcPercentiles(sortedData, "when");
    expect(pcts.p50).toBeLessThanOrEqual(pcts.p70);
    expect(pcts.p70).toBeLessThanOrEqual(pcts.p85);
    expect(pcts.p85).toBeLessThanOrEqual(pcts.p95);
  });

  it("P(value >= p85 in howmany) ≈ 85%, within ±2%", () => {
    const { p85 } = calcPercentiles(sortedData, "howmany");
    const actual = (randomData.filter((v) => v >= p85).length / N) * 100;
    expect(actual).toBeGreaterThanOrEqual(83);
    expect(actual).toBeLessThanOrEqual(87);
  });
});
