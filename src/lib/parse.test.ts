import { describe, it, expect } from "vitest";
import { parseTP } from "./parse";

describe("parseTP", () => {
  it("parses comma-separated floats", () => {
    expect(parseTP("1, 2, 3")).toEqual([1, 2, 3]);
  });

  it("filters non-numeric tokens", () => {
    expect(parseTP("1, abc, 3")).toEqual([1, 3]);
  });

  it("filters negative values", () => {
    expect(parseTP("-1, 2, 3")).toEqual([2, 3]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTP("")).toEqual([]);
  });

  it("allows zeros", () => {
    expect(parseTP("0, 2")).toEqual([0, 2]);
  });
});
