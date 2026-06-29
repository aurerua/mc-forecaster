import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { bucketByDay, fetchThroughput, countJiraTypes, countResolutions, buildJql, buildEpicJql, fetchEpicCounts } from "./jira";
import type { JiraConfig } from "./jira";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeConfig(overrides: Partial<JiraConfig> = {}): JiraConfig {
  return {
    baseUrl: "https://test.atlassian.net",
    email: "user@test.com",
    token: "tok",
    project: "TEST",
    from: "2020-01-06",  // Monday
    to: "2020-01-08",    // Wednesday
    types: ["Story"],
    excludeResolutions: [],
    excludeWeekends: false,
    noCache: true,
    cacheDir: mkdtempSync(join(tmpdir(), "mcf-test-")),
    ...overrides,
  };
}

function jiraPage(keys: string[], date: string, isLast = true, nextPageToken?: string, resolution?: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      isLast,
      nextPageToken,
      issues: keys.map((key) => ({
        key,
        fields: {
          statuscategorychangedate: `${date}T10:00:00.000+0000`,
          ...(resolution ? { resolution: { name: resolution } } : {}),
        },
      })),
    }),
  };
}

let savedFetch: typeof globalThis.fetch;
beforeEach(() => { savedFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = savedFetch; vi.restoreAllMocks(); });

describe("bucketByDay", () => {
  it("counts tickets per day correctly", () => {
    const issues = [
      { key: "A-1", date: "2026-06-08" },
      { key: "A-2", date: "2026-06-08" },
      { key: "A-3", date: "2026-06-10" },
    ];
    expect(bucketByDay(issues, "2026-06-08", "2026-06-10", false)).toEqual([2, 0, 1]);
  });

  it("zero-fills days with no tickets", () => {
    expect(bucketByDay([], "2026-06-08", "2026-06-10", false)).toEqual([0, 0, 0]);
  });

  it("excludes Sat and Sun when excludeWeekends is true", () => {
    // 2026-06-06 Sat, 06-07 Sun, 06-08 Mon, 06-09 Tue
    const issues = [{ key: "A-1", date: "2026-06-08" }];
    expect(bucketByDay(issues, "2026-06-06", "2026-06-09", true)).toEqual([1, 0]);
  });

  it("includes Sat and Sun when excludeWeekends is false", () => {
    const issues = [{ key: "A-1", date: "2026-06-06" }];
    expect(bucketByDay(issues, "2026-06-06", "2026-06-09", false)).toEqual([1, 0, 0, 0]);
  });

  it("ignores issues outside the from–to range", () => {
    const issues = [
      { key: "A-1", date: "2026-06-05" }, // before range
      { key: "A-2", date: "2026-06-08" }, // in range
      { key: "A-3", date: "2026-06-11" }, // after range
    ];
    expect(bucketByDay(issues, "2026-06-08", "2026-06-10", false)).toEqual([1, 0, 0]);
  });

  it("returns a single-element array for a one-day range", () => {
    const issues = [{ key: "A-1", date: "2026-06-09" }];
    expect(bucketByDay(issues, "2026-06-09", "2026-06-09", false)).toEqual([1]);
  });
});

afterEach(() => vi.restoreAllMocks());

describe("countJiraTypes", () => {
  it("groups issues by type and counts them", () => {
    const issues = [
      { key: "T-1", date: "2020-01-06", type: "Story" },
      { key: "T-2", date: "2020-01-06", type: "Bug" },
      { key: "T-3", date: "2020-01-07", type: "Story" },
      { key: "T-4", date: "2020-01-07" },
    ];
    expect(countJiraTypes(issues)).toEqual({ Story: 2, Bug: 1 });
  });
});

describe("countResolutions", () => {
  it("groups issues by resolution and skips missing ones", () => {
    const issues = [
      { key: "T-1", date: "2020-01-06", resolution: "Done" },
      { key: "T-2", date: "2020-01-06", resolution: "Won't Do" },
      { key: "T-3", date: "2020-01-07", resolution: "Done" },
      { key: "T-4", date: "2020-01-07" },
    ];
    expect(countResolutions(issues)).toEqual({ Done: 2, "Won't Do": 1 });
  });
});

describe("buildJql", () => {
  it("omits the resolution clause when no resolutions are excluded", () => {
    const jql = buildJql(makeConfig({ excludeResolutions: [] }));
    expect(jql).not.toContain("resolution NOT IN");
  });

  it("adds a quoted resolution NOT IN clause when resolutions are excluded", () => {
    const jql = buildJql(makeConfig({ excludeResolutions: ["Won't Do", "Won't Fix"] }));
    expect(jql).toContain(`AND resolution NOT IN ("Won't Do", "Won't Fix")`);
  });
});

describe("fetchThroughput — HTTP", () => {
  it("fetches a single page and buckets correctly", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jiraPage(["T-1", "T-2"], "2020-01-06")) as any;
    const result = await fetchThroughput(makeConfig());
    expect(result.throughput).toEqual([2, 0, 0]);
  });

  it("returns a resolution breakdown from fetched issues", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jiraPage(["T-1", "T-2"], "2020-01-06", true, undefined, "Won't Do")
    ) as any;
    const result = await fetchThroughput(makeConfig());
    expect(result.resolutions).toEqual({ "Won't Do": 2 });
  });

  it("auto-paginates across two pages", async () => {
    const page1 = jiraPage(Array.from({ length: 100 }, (_, i) => `T-${i}`), "2020-01-06", false, "cursor_page2");
    const page2 = jiraPage(Array.from({ length: 50 }, (_, i) => `T-${i + 100}`), "2020-01-07", true);
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    globalThis.fetch = mockFetch as any;
    const result = await fetchThroughput(makeConfig());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.throughput).toEqual([100, 50, 0]);
  });

  it("throws on 401 with auth message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as any;
    await expect(fetchThroughput(makeConfig())).rejects.toThrow(/auth failed/i);
  });

  it("throws on 400 with Jira's error message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ errorMessages: ["Field 'xyz' does not exist"] }),
    }) as any;
    await expect(fetchThroughput(makeConfig())).rejects.toThrow(/Field 'xyz' does not exist/);
  });

  it("retries once on 429 and succeeds", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(jiraPage(["T-1"], "2020-01-06"));
    globalThis.fetch = mockFetch as any;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => { fn(); return 0 as any; });
    const result = await fetchThroughput(makeConfig());
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.throughput[0]).toBe(1);
  });

  it("throws after two consecutive 429s", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }) as any;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => { fn(); return 0 as any; });
    await expect(fetchThroughput(makeConfig())).rejects.toThrow(/rate limit/i);
  });
});

describe("fetchThroughput — cache", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcf-cache-test-"));
    globalThis.fetch = vi.fn().mockResolvedValue(
      jiraPage(["T-1"], "2020-01-06", true)
    ) as any;
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    rmSync(tmpDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it("writes cache on first fetch and reads it on second (past range)", async () => {
    const cfg = makeConfig({ noCache: false, to: "2020-01-08", cacheDir: tmpDir });
    await fetchThroughput(cfg);
    await fetchThroughput(cfg);
    expect(globalThis.fetch as any).toHaveBeenCalledTimes(1);
  });

  it("treats a different excludeResolutions list as a separate cache entry", async () => {
    const cfg = makeConfig({ noCache: false, to: "2020-01-08", cacheDir: tmpDir });
    await fetchThroughput(cfg);
    // Different exclusion list -> different cache key -> must re-fetch.
    await fetchThroughput({ ...cfg, excludeResolutions: ["Won't Do"] });
    expect(globalThis.fetch as any).toHaveBeenCalledTimes(2);
  });

  it("skips cache when --to >= today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const cfg = makeConfig({ noCache: false, to: today, cacheDir: tmpDir });
    await fetchThroughput(cfg);
    await fetchThroughput(cfg);
    expect(globalThis.fetch as any).toHaveBeenCalledTimes(2);
  });

  it("skips cache when noCache is true", async () => {
    const cfg = makeConfig({ noCache: true, to: "2020-01-08", cacheDir: tmpDir });
    await fetchThroughput(cfg);

    const cachedCfg = { ...cfg, noCache: false };
    await fetchThroughput(cachedCfg);

    // First call fetches and writes refreshed cache; second call reads that cache.
    expect(globalThis.fetch as any).toHaveBeenCalledTimes(1);
  });

  it("refreshes an existing cache entry when noCache is true", async () => {
    const staleCfg = makeConfig({ noCache: false, to: "2020-01-08", cacheDir: tmpDir });

    // Seed cache with day-1 data.
    globalThis.fetch = vi.fn().mockResolvedValueOnce(jiraPage(["T-1"], "2020-01-06", true)) as any;
    await fetchThroughput(staleCfg);

    // Force refresh with different data and ensure cache is replaced.
    globalThis.fetch = vi.fn().mockResolvedValueOnce(jiraPage(["T-2", "T-3"], "2020-01-07", true)) as any;
    await fetchThroughput({ ...staleCfg, noCache: true });

    // Cached read should now return refreshed data (0 on day 1, 2 on day 2).
    const refreshed = await fetchThroughput(staleCfg);
    expect(refreshed.throughput).toEqual([0, 2, 0]);
  });
});

describe("buildEpicJql", () => {
  it("includes parent filter and statusCategory != Done", () => {
    const cfg = makeConfig({ types: ["Story", "Bug"] });
    const jql = buildEpicJql("PROJ-1", cfg.types);
    expect(jql).toContain('parent = "PROJ-1"');
    expect(jql).toContain("statusCategory != Done");
    expect(jql).toContain('"Story"');
    expect(jql).toContain('"Bug"');
  });

  it("does not include project or date filters", () => {
    const cfg = makeConfig();
    const jql = buildEpicJql("PROJ-2", cfg.types);
    expect(jql).not.toContain("statusCategoryChangedDate");
    expect(jql).not.toContain("project =");
  });
});

describe("fetchEpicCounts", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcf-epic-test-"));
    savedFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = savedFetch;
    rmSync(tmpDir, { recursive: true });
    vi.restoreAllMocks();
  });

  function epicCountResponse(total: number) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        issues: Array.from({ length: total }, (_, i) => ({ key: `FAKE-${i}` })),
        isLast: true,
      }),
    };
  }

  it("fetches open ticket count for each epic key", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(epicCountResponse(12))
      .mockResolvedValueOnce(epicCountResponse(7)) as any;
    const cfg = makeConfig({ noCache: true, cacheDir: tmpDir });
    const result = await fetchEpicCounts(cfg, ["PROJ-1", "PROJ-2"], cfg.types);
    expect(result).toEqual([
      { key: "PROJ-1", count: 12 },
      { key: "PROJ-2", count: 7 },
    ]);
  });

  it("sends correct JQL in request body for each epic", async () => {
    const mockFetch = vi.fn().mockResolvedValue(epicCountResponse(5)) as any;
    globalThis.fetch = mockFetch;
    const cfg = makeConfig({ noCache: true, cacheDir: tmpDir, types: ["Story"] });
    await fetchEpicCounts(cfg, ["EPIC-99"], cfg.types);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jql).toContain('parent = "EPIC-99"');
    expect(body.jql).toContain("statusCategory != Done");
    expect(body.jql).toContain('"Story"');
  });

  it("uses the passed epic types for the JQL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(epicCountResponse(3)) as any;
    globalThis.fetch = mockFetch;
    const cfg = makeConfig({ noCache: true, cacheDir: tmpDir, types: ["Bug", "Story"] });
    await fetchEpicCounts(cfg, ["EPIC-1"], ["Task", "Spike"]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jql).toContain('"Task"');
    expect(body.jql).toContain('"Spike"');
    expect(body.jql).not.toContain('"Bug"');
  });

  it("reads from 5-min TTL cache on second call", async () => {
    const mockFetch = vi.fn().mockResolvedValue(epicCountResponse(8)) as any;
    globalThis.fetch = mockFetch;
    const cfg = makeConfig({ noCache: false, cacheDir: tmpDir });
    await fetchEpicCounts(cfg, ["EPIC-A"], cfg.types);
    await fetchEpicCounts(cfg, ["EPIC-A"], cfg.types);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("bypasses cache when noCache is true", async () => {
    const mockFetch = vi.fn().mockResolvedValue(epicCountResponse(8)) as any;
    globalThis.fetch = mockFetch;
    const cfg = makeConfig({ noCache: true, cacheDir: tmpDir });
    await fetchEpicCounts(cfg, ["EPIC-A"], cfg.types);
    await fetchEpicCounts(cfg, ["EPIC-A"], cfg.types);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("refetches after TTL expires (simulated by writing stale cache file)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(epicCountResponse(5)) as any;
    globalThis.fetch = mockFetch;
    const cfg = makeConfig({ noCache: false, cacheDir: tmpDir, types: ["Story"] });
    // Seed an expired cache entry (cachedAt = 10 min ago)
    const staleTs = Date.now() - 10 * 60 * 1000;
    const hash = (await import("node:crypto")).createHash("sha256")
      .update(JSON.stringify({ epic: "EPIC-B", types: ["Story"] }))
      .digest("hex");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      join(tmpDir, `epic-${hash}.json`),
      JSON.stringify({ epicKey: "EPIC-B", count: 99, cachedAt: staleTs })
    );
    const result = await fetchEpicCounts(cfg, ["EPIC-B"], cfg.types);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result[0].count).toBe(5);
  });

  it("throws on 401 with auth message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as any;
    const cfg = makeConfig({ noCache: true, cacheDir: tmpDir });
    await expect(fetchEpicCounts(cfg, ["EPIC-X"], cfg.types)).rejects.toThrow(/auth failed/i);
  });
});
