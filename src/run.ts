import { runHowMany, runWhen, runWhenSequential, capacityRatio, calcPercentiles } from "./lib";
import type { SimMode, PercentileResult } from "./lib";
import type { ForecastConfig, Headcount } from "./args";
import type { EpicCount } from "./jira";

export type Verdict = "On Track" | "At Risk" | "Unlikely";

export interface Probability {
  reference: number;
  pct: number;
  verdict: Verdict;
}

export interface ForecastResult {
  mode: SimMode;
  unit: "items" | "days";
  runs: number;
  days?: number;
  capRatio: number;
  headcount?: Headcount;
  headcountSource?: "workday";
  percentiles: PercentileResult;
  mean: number;
  min: number;
  max: number;
  probability?: Probability;
}

export interface EpicResult {
  key: string;
  count: number;
  buffer: number;
  durationPercentiles: PercentileResult;
  cumulativePercentiles: PercentileResult;
}

export interface EpicForecastResult {
  runs: number;
  capRatio: number;
  headcount?: Headcount;
  headcountSource?: "workday";
  globalPercentiles: PercentileResult;
  epics: EpicResult[];
}

export function forecast(cfg: ForecastConfig): ForecastResult {
  const capRatio = cfg.headcount
    ? capacityRatio(cfg.headcount.data, cfg.headcount.forecast)
    : 1;

  const raw = cfg.mode === "howmany"
    ? runHowMany(cfg.throughput, cfg.days!, cfg.runs, capRatio)
    : runWhen(cfg.throughput, cfg.tickets!, cfg.runs, capRatio);

  const sorted = [...raw].sort((a, b) => a - b);
  const percentiles: PercentileResult = calcPercentiles(sorted, cfg.mode);
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const unit = cfg.mode === "howmany" ? "items" : "days";

  let probability: Probability | undefined;
  const reference = cfg.mode === "howmany" ? cfg.tickets : cfg.days;
  if (reference != null) {
    const hit = cfg.mode === "howmany"
      ? raw.filter((v) => v >= reference).length
      : raw.filter((v) => v <= reference).length;
    const pct = (hit / raw.length) * 100;
    const verdict: Verdict = pct >= 85 ? "On Track" : pct >= 60 ? "At Risk" : "Unlikely";
    probability = { reference, pct, verdict };
  }

  return {
    mode: cfg.mode,
    unit,
    runs: cfg.runs,
    days: cfg.mode === "howmany" ? cfg.days : undefined,
    capRatio,
    headcount: cfg.headcount,
    headcountSource: cfg.workdayHeadcount ? "workday" : undefined,
    percentiles,
    mean,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    probability,
  };
}

export function forecastEpics(cfg: ForecastConfig, epicCounts: Array<EpicCount & { buffer?: number }>): EpicForecastResult {
  const capRatio = cfg.headcount ? capacityRatio(cfg.headcount.data, cfg.headcount.forecast) : 1;
  const ticketCounts = epicCounts.map((e) => e.count + (e.buffer ?? 0));
  const cumDaysPerEpic = runWhenSequential(cfg.throughput, ticketCounts, cfg.runs, capRatio);

  const epics: EpicResult[] = epicCounts.map((epic, e) => {
    const durRaw = cumDaysPerEpic[e].map((d, sim) =>
      e === 0 ? d : d - cumDaysPerEpic[e - 1][sim]
    );
    const durSorted = [...durRaw].sort((a, b) => a - b);
    const cumSorted = [...cumDaysPerEpic[e]].sort((a, b) => a - b);
    return {
      key: epic.key,
      count: epic.count,
      buffer: epic.buffer ?? 0,
      durationPercentiles: calcPercentiles(durSorted, "when"),
      cumulativePercentiles: calcPercentiles(cumSorted, "when"),
    };
  });

  const lastCumSorted = [...cumDaysPerEpic[cumDaysPerEpic.length - 1]].sort((a, b) => a - b);
  return {
    runs: cfg.runs,
    capRatio,
    headcount: cfg.headcount,
    headcountSource: cfg.workdayHeadcount ? "workday" : undefined,
    globalPercentiles: calcPercentiles(lastCumSorted, "when"),
    epics,
  };
}
