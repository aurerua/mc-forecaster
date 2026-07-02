import { describe, it, expect, vi } from "vitest";
import { buildUrl, avgAvailable, addDaysToYMD, addWorkingDaysToYMD, fetchVacations, fetchReportJson } from "./workday";
import type { WorkdayConfig } from "./workday";

describe("buildUrl", () => {
  it("appends date params and format=json with ? when no existing query string", () => {
    const result = buildUrl(
      "https://wd.example.com/report",
      "2026-06-01", "2026-08-31",
      "DateFrom", "DateTo"
    );
    expect(result).toBe("https://wd.example.com/report?DateFrom=2026-06-01&DateTo=2026-08-31&format=json");
  });

  it("appends with & when base URL already has query params", () => {
    const result = buildUrl(
      "https://wd.example.com/report?filter=abc",
      "2026-06-01", "2026-08-31",
      "DateFrom", "DateTo"
    );
    expect(result).toBe("https://wd.example.com/report?filter=abc&DateFrom=2026-06-01&DateTo=2026-08-31&format=json");
  });

  it("uses the configured param names", () => {
    const result = buildUrl(
      "https://wd.example.com/report",
      "2026-06-01", "2026-08-31",
      "Event_Effective_Date_On_or_After", "Event_Effective_Date_On_or_Before"
    );
    expect(result).toContain("Event_Effective_Date_On_or_After=2026-06-01");
    expect(result).toContain("Event_Effective_Date_On_or_Before=2026-08-31");
  });
});

describe("avgAvailable", () => {
  const vacations = [
    { worker: "Alice", from: "2026-06-09", to: "2026-06-13" }, // Mon–Fri
    { worker: "Bob",   from: "2026-06-15", to: "2026-06-17" }, // Mon–Wed
  ];

  it("returns teamSize when no vacations", () => {
    const result = avgAvailable([], 5, [], [], "2026-06-09", "2026-06-13", false);
    expect(result).toBe(5);
  });

  it("subtracts one absent worker per day", () => {
    // Alice is out all 5 days (Mon–Fri), team of 5
    const result = avgAvailable(vacations, 5, [], [], "2026-06-09", "2026-06-13", false);
    expect(result).toBeCloseTo(4.0);
  });

  it("deduplicates overlapping entries for the same worker", () => {
    const doubled = [
      { worker: "Alice", from: "2026-06-09", to: "2026-06-13" },
      { worker: "Alice", from: "2026-06-11", to: "2026-06-15" },
    ];
    const result = avgAvailable(doubled, 5, [], [], "2026-06-09", "2026-06-13", false);
    expect(result).toBeCloseTo(4.0);
  });

  it("excludes weekends when flag is set", () => {
    // Alice out Mon–Fri week 1 (5 days), Bob out Mon–Wed week 2 (3 days) = 8 working days
    // 4 available each day → avg 4.0
    const result = avgAvailable(vacations, 5, [], [], "2026-06-09", "2026-06-17", true);
    expect(result).toBeCloseTo(4.0);
  });

  it("applies leavers from their date onward", () => {
    // Team of 4. Leaver on Wed 2026-06-11 → size drops to 3 from Wed.
    // Mon: 4, Tue: 4, Wed: 3, Thu: 3, Fri: 3 → avg = 17/5 = 3.4
    const result = avgAvailable([], 4, [], ["2026-06-11"], "2026-06-09", "2026-06-13", false);
    expect(result).toBeCloseTo(3.4);
  });

  it("applies joiners from their date onward", () => {
    // Team of 3. Joiner on Wed 2026-06-11 → size grows to 4 from Wed.
    // Mon: 3, Tue: 3, Wed: 4, Thu: 4, Fri: 4 → avg = 18/5 = 3.6
    const result = avgAvailable([], 3, ["2026-06-11"], [], "2026-06-09", "2026-06-13", false);
    expect(result).toBeCloseTo(3.6);
  });

  it("clamps available to zero when absences exceed team size", () => {
    const manyAbsent = [
      { worker: "A", from: "2026-06-09", to: "2026-06-09" },
      { worker: "B", from: "2026-06-09", to: "2026-06-09" },
      { worker: "C", from: "2026-06-09", to: "2026-06-09" },
    ];
    const result = avgAvailable(manyAbsent, 2, [], [], "2026-06-09", "2026-06-09", false);
    expect(result).toBe(0);
  });
});

describe("addDaysToYMD", () => {
  it("adds days correctly", () => {
    expect(addDaysToYMD("2026-06-30", 1)).toBe("2026-07-01");
    expect(addDaysToYMD("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToYMD("2026-06-30", 0)).toBe("2026-06-30");
  });
});

describe("addWorkingDaysToYMD", () => {
  it("returns start date unchanged when n is 0", () => {
    expect(addWorkingDaysToYMD("2026-06-24", 0)).toBe("2026-06-24"); // Wednesday
  });

  it("skips weekends when counting forward", () => {
    // 2026-06-24 is Wednesday; +9 working days lands on 2026-07-07 (Tuesday)
    expect(addWorkingDaysToYMD("2026-06-24", 9)).toBe("2026-07-07");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-06-29 is Monday; +5 working days = 2026-07-06 (Monday)
    expect(addWorkingDaysToYMD("2026-06-29", 5)).toBe("2026-07-06");
  });
});

describe("fetchVacations", () => {
  const cfg: WorkdayConfig = {
    jsonLink: "https://services1.wd502.myworkday.com/ccx/service/customreport2/yourcompany/ISU/Report",
    user: "testuser",
    password: "testpass",
    excludeWorkers: ["Peter Seidel"],
    noCache: true,
    cacheDir: "/tmp/wd-test-cache",
    fields: { entries: "Report_Entry", worker: "Worker", dateFrom: "From", dateTo: "To" },
    dateParams: { from: "Event_Effective_Date_On_or_After", to: "Event_Effective_Date_On_or_Before" },
  };

  it("parses Report_Entry into WorkdayEntry[], excludes workers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          Report_Entry: [
            { Worker: "Alice Smith", From: "2026-06-09", To: "2026-06-13" },
            { Worker: "Peter Seidel", From: "2026-06-10", To: "2026-06-12" },
          ],
        }),
        { status: 200 }
      )
    ) as any;

    const entries = await fetchVacations(cfg, "2026-05-01", "2026-08-01");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ worker: "Alice Smith", from: "2026-06-09", to: "2026-06-13" });
    vi.restoreAllMocks();
  });

  it("throws on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    ) as any;
    await expect(fetchVacations(cfg, "2026-05-01", "2026-08-01")).rejects.toThrow(
      "Workday auth failed"
    );
    vi.restoreAllMocks();
  });

  it("throws on non-200 status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    ) as any;
    await expect(fetchVacations(cfg, "2026-05-01", "2026-08-01")).rejects.toThrow(
      "Workday request failed: 500"
    );
    vi.restoreAllMocks();
  });

  it("handles empty Report_Entry", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 })
    ) as any;
    const entries = await fetchVacations(cfg, "2026-05-01", "2026-08-01");
    expect(entries).toEqual([]);
    vi.restoreAllMocks();
  });

  it("uses custom field mapping when configured", async () => {
    const customCfg: WorkdayConfig = {
      ...cfg,
      fields: { entries: "data", worker: "name", dateFrom: "start", dateTo: "end" },
    };
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ name: "Alice Smith", start: "2026-06-09", end: "2026-06-13" }],
        }),
        { status: 200 }
      )
    ) as any;
    const entries = await fetchVacations(customCfg, "2026-05-01", "2026-08-01");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ worker: "Alice Smith", from: "2026-06-09", to: "2026-06-13" });
    vi.restoreAllMocks();
  });
});

describe("fetchReportJson", () => {
  it("returns the parsed JSON report", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ Report_Entry: [{ Worker: "Alice Smith", From: "2026-06-09", To: "2026-06-13" }] }),
        { status: 200 }
      )
    ) as any;

    const json = await fetchReportJson(
      "https://services1.wd502.myworkday.com/ccx/service/customreport2/yourcompany/ISU/Report",
      "testuser", "testpass",
      "2026-05-01", "2026-08-01",
      "Event_Effective_Date_On_or_After", "Event_Effective_Date_On_or_Before"
    );

    expect(json).toEqual({ Report_Entry: [{ Worker: "Alice Smith", From: "2026-06-09", To: "2026-06-13" }] });
    vi.restoreAllMocks();
  });

  it("throws on 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    ) as any;

    await expect(
      fetchReportJson(
        "https://services1.wd502.myworkday.com/ccx/service/customreport2/yourcompany/ISU/Report",
        "testuser", "testpass",
        "2026-05-01", "2026-08-01",
        "Event_Effective_Date_On_or_After", "Event_Effective_Date_On_or_Before"
      )
    ).rejects.toThrow("Workday auth failed");
    vi.restoreAllMocks();
  });
});
