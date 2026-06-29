import type { PercentileResult, SimMode } from "./types";

const CONFIDENCES = [
  { key: "p50" as const, confidence: 50 },
  { key: "p70" as const, confidence: 70 },
  { key: "p85" as const, confidence: 85 },
  { key: "p95" as const, confidence: 95 },
];

export function calcPercentiles(sorted: number[], mode: SimMode): PercentileResult {
  const n = sorted.length;
  const res = {} as PercentileResult;
  for (const { key, confidence } of CONFIDENCES) {
    const p = mode === "howmany" ? 100 - confidence : confidence;
    const idx = Math.max(0, Math.ceil((p / 100) * n) - 1);
    res[key] = sorted[idx];
  }
  return res;
}
