export function parseTP(s: string): number[] {
  return s
    .split(",")
    .map((v) => parseFloat(v.trim()))
    .filter((n) => !isNaN(n) && n >= 0);
}
