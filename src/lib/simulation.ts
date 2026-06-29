export function runHowMany(
  throughput: number[],
  sprintDays: number,
  numSims: number,
  capRatio = 1
): number[] {
  const n = throughput.length;
  const results = new Array<number>(numSims);
  for (let i = 0; i < numSims; i++) {
    let t = 0;
    for (let d = 0; d < sprintDays; d++) {
      t += throughput[Math.floor(Math.random() * n)] * capRatio;
    }
    results[i] = t;
  }
  return results;
}

export function runWhen(
  throughput: number[],
  targetItems: number,
  numSims: number,
  capRatio = 1
): number[] {
  const n = throughput.length;
  const results = new Array<number>(numSims);
  for (let i = 0; i < numSims; i++) {
    let rem = targetItems;
    let days = 0;
    while (rem > 0 && days < 10000) {
      rem -= throughput[Math.floor(Math.random() * n)] * capRatio;
      days++;
    }
    results[i] = days;
  }
  return results;
}

export function capacityRatio(
  histHC: number | string,
  forecastHC: number | string
): number {
  const h = Number(histHC);
  const f = Number(forecastHC);
  if (!isFinite(h) || h <= 0 || !isFinite(f) || f <= 0) return 1;
  return f / h;
}

export function runWhenSequential(
  throughput: number[],
  ticketCounts: number[],
  numSims: number,
  capRatio = 1
): number[][] {
  const n = throughput.length;
  const numEpics = ticketCounts.length;
  // result[epicIndex][simIndex] = cumulative finish day in that run
  const result: number[][] = Array.from({ length: numEpics }, () => new Array<number>(numSims));

  for (let sim = 0; sim < numSims; sim++) {
    let cumDays = 0;
    for (let e = 0; e < numEpics; e++) {
      let rem = ticketCounts[e];
      let days = 0;
      while (rem > 0 && days < 10000) {
        rem -= throughput[Math.floor(Math.random() * n)] * capRatio;
        days++;
      }
      cumDays += days;
      result[e][sim] = cumDays;
    }
  }

  return result;
}
