import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { parseConfig, MissingJiraTypesError } from "./args";

// Suppress ~/.config/mcf/env file-derived values so every test controls its own env.
// process.env wins over the file in loadMcfEnv(), so empty string overrides any file key.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.MCF_DEFAULT_PROJECT = "";
  process.env.MCF_JIRA_TYPES = "";
  process.env.JIRA_URL = "";
  process.env.JIRA_EMAIL = "";
  process.env.JIRA_TOKEN = "";
});
afterEach(() => {
  Object.keys(process.env).forEach((k) => { if (!(k in ORIGINAL_ENV)) delete process.env[k]; });
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("parseConfig", () => {
  it("defaults runs to 10000", () => {
    const c = parseConfig(["--how-many", "--days", "10", "--throughput", "2,4,6"]);
    expect(c.runs).toBe(10000);
  });

  it("parses a how-many config", () => {
    const c = parseConfig([
      "--how-many", "--days", "10", "--throughput", "2,4,6",
      "--tickets", "30", "--runs", "5000",
    ]);
    expect(c).toMatchObject({
      mode: "howmany", days: 10, tickets: 30, runs: 5000,
      throughput: [2, 4, 6], json: false,
    });
  });

  it("parses a when config with headcount and json", () => {
    const c = parseConfig([
      "--when", "--tickets", "30", "--throughput", "2,4,6",
      "--headcount", "4.5,3", "--json",
    ]);
    expect(c.mode).toBe("when");
    expect(c.headcount).toEqual({ data: 4.5, forecast: 3 });
    expect(c.json).toBe(true);
  });

  it("throws when both modes are given", () => {
    expect(() => parseConfig(["--how-many", "--when", "--days", "10", "--throughput", "2"]))
      .toThrow(/only one/i);
  });

  it("throws when no mode is given", () => {
    expect(() => parseConfig(["--days", "10", "--throughput", "2"])).toThrow(/mode/i);
  });

  it("throws when throughput is missing", () => {
    expect(() => parseConfig(["--how-many", "--days", "10"])).toThrow(/throughput.*project/i);
  });

  it("throws when how-many has no days", () => {
    expect(() => parseConfig(["--how-many", "--throughput", "2,4"])).toThrow(/--days/);
  });

  it("throws when when has no tickets", () => {
    expect(() => parseConfig(["--when", "--throughput", "2,4"])).toThrow(/--tickets/);
  });

  it("throws on malformed headcount (one value)", () => {
    expect(() => parseConfig(["--when", "--tickets", "10", "--throughput", "2", "--headcount", "4.5"]))
      .toThrow(/headcount/i);
  });

  it("throws on non-positive runs", () => {
    expect(() => parseConfig(["--how-many", "--days", "10", "--throughput", "2", "--runs", "0"]))
      .toThrow(/runs/i);
  });

  it("throws on an unrecognised flag", () => {
    expect(() =>
      parseConfig(["--how-many", "--days", "10", "--throughput", "2,4,6", "--unknown-flag"])
    ).toThrow();
  });
});

function withJiraEnv() {
  process.env.JIRA_URL = "https://test.atlassian.net";
  process.env.JIRA_EMAIL = "user@test.com";
  process.env.JIRA_TOKEN = "tok";
  process.env.MCF_JIRA_TYPES = "Bug,Story,Task,Spike";
}

describe("parseConfig — Jira path", () => {
  it("accepts --project and builds a JiraConfig", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19"]);
    expect(c.jira).toBeDefined();
    expect(c.jira!.project).toBe("PROJ");
    expect(c.jira!.from).toBe("2026-06-06");
    expect(c.jira!.to).toBe("2026-06-19");
    expect(c.throughput).toEqual([]);
  });

  it("uses MCF_JIRA_TYPES as the type universe when no exclusions", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19"]);
    expect(c.jira!.types).toEqual(["Bug", "Story", "Task", "Spike"]);
  });

  it("subtracts --exclude-types from the universe", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
      "--exclude-types", "Spike,Task"]);
    expect(c.jira!.types).toEqual(["Bug", "Story"]);
  });

  it("defaults excludeResolutions to an empty list", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19"]);
    expect(c.jira!.excludeResolutions).toEqual([]);
    expect(c.showResolutions).toBe(false);
  });

  it("parses --exclude-resolutions and --show-resolutions", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
      "--exclude-resolutions", "Won't Do,Won't Fix", "--show-resolutions"]);
    expect(c.jira!.excludeResolutions).toEqual(["Won't Do", "Won't Fix"]);
    expect(c.showResolutions).toBe(true);
  });

  it("throws MissingJiraTypesError when MCF_JIRA_TYPES is unset on the Jira path", () => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "user@test.com";
    process.env.JIRA_TOKEN = "tok";
    expect(() => parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19"])).toThrow(MissingJiraTypesError);
  });

  it("throws when --exclude-types removes every type", () => {
    withJiraEnv();
    expect(() => parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
      "--exclude-types", "Bug,Story,Task,Spike"])).toThrow(/nothing left/i);
  });

  it("sets excludeWeekends from --exclude-weekends", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19", "--exclude-weekends"]);
    expect(c.jira!.excludeWeekends).toBe(true);
  });

  it("sets noCache from --no-cache", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19", "--no-cache"]);
    expect(c.jira!.noCache).toBe(true);
  });

  it("defaults --from to 90 days ago and --to to yesterday", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ"]);
    expect(c.jira!.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.jira!.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.jira!.from < c.jira!.to).toBe(true);
  });

  it("throws when --project and --throughput are both present", () => {
    withJiraEnv();
    expect(() =>
      parseConfig(["--how-many", "--days", "10", "--project", "PROJ", "--throughput", "2,4,6"])
    ).toThrow(/mutually exclusive/i);
  });

  it("throws when neither --project nor --throughput is present", () => {
    withJiraEnv();
    expect(() =>
      parseConfig(["--how-many", "--days", "10"])
    ).toThrow(/throughput.*project/i);
  });

  it("throws when JIRA_URL is missing", () => {
    process.env.JIRA_EMAIL = "u@test.com";
    process.env.JIRA_TOKEN = "tok";
    expect(() =>
      parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
        "--from", "2026-06-06", "--to", "2026-06-19"])
    ).toThrow(/JIRA_URL/);
  });

  it("throws on invalid --from date", () => {
    withJiraEnv();
    expect(() =>
      parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
        "--from", "not-a-date", "--to", "2026-06-19"])
    ).toThrow(/--from/i);
  });

  it("throws when --from is after --to", () => {
    withJiraEnv();
    expect(() =>
      parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
        "--from", "2026-06-19", "--to", "2026-06-06"])
    ).toThrow(/--from.*after.*--to/i);
  });

  it("parses --show-jql flag", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19", "--show-jql"]);
    expect(c.showJql).toBe(true);
  });

  it("defaults showJql to false", () => {
    withJiraEnv();
    const c = parseConfig(["--how-many", "--days", "10", "--project", "PROJ",
      "--from", "2026-06-06", "--to", "2026-06-19"]);
    expect(c.showJql).toBe(false);
  });

  it("accepts --show-jql on manual path too", () => {
    const c = parseConfig(["--how-many", "--days", "10", "--throughput", "2,4,6", "--show-jql"]);
    expect(c.showJql).toBe(true);
  });
});

describe("parseConfig — --epics flag", () => {
  it("parses --epics into an array of EpicSpec", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1,PROJ-2", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
    ]);
    expect(c.epics).toEqual([{ key: "PROJ-1", buffer: 0 }, { key: "PROJ-2", buffer: 0 }]);
    expect(c.tickets).toBeUndefined();
  });

  it("subtracts --exclude-epic-types from the universe for epicTypes", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
      "--exclude-epic-types", "Task,Spike",
    ]);
    expect(c.epicTypes).toEqual(["Bug", "Story"]);
  });

  it("epicTypes defaults to the full universe when --exclude-epic-types is omitted", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
    ]);
    expect(c.epicTypes).toEqual(["Bug", "Story", "Task", "Spike"]);
  });

  it("--exclude-epic-types is independent of --exclude-types", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
      "--exclude-types", "Bug", "--exclude-epic-types", "Spike",
    ]);
    expect(c.jira!.types).toEqual(["Story", "Task", "Spike"]);
    expect(c.epicTypes).toEqual(["Bug", "Story", "Task"]);
  });

  it("throws when --epics and --tickets are both present", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--when", "--tickets", "30", "--epics", "PROJ-1", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
      ])
    ).toThrow(/mutually exclusive/i);
  });

  it("throws when --epics is used without a Jira project", () => {
    expect(() =>
      parseConfig(["--when", "--epics", "PROJ-1", "--throughput", "2,4,6"])
    ).toThrow(/project/i);
  });

  it("throws when --epics is used with --how-many", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--how-many", "--days", "10", "--epics", "PROJ-1", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
      ])
    ).toThrow(/--epics.*--when/i);
  });

  it("throws when --when has neither --tickets nor --epics", () => {
    expect(() =>
      parseConfig(["--when", "--throughput", "2,4,6"])
    ).toThrow(/--tickets.*--epics/i);
  });

  it("throws when --epics is empty (only commas)", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--when", "--epics", ",", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
      ])
    ).toThrow(/at least one key/i);
  });

  it("parses epic key without +N as buffer 0", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
    ]);
    expect(c.epics).toEqual([{ key: "PROJ-1", buffer: 0 }]);
  });

  it("parses +N buffer appended to epic key", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1+3", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
    ]);
    expect(c.epics).toEqual([{ key: "PROJ-1", buffer: 3 }]);
  });

  it("parses mixed buffered and unbuffered epics", () => {
    withJiraEnv();
    const c = parseConfig([
      "--when", "--epics", "PROJ-1+3,PROJ-2,PROJ-3+8", "--project", "MYPROJ",
      "--from", "2026-06-06", "--to", "2026-06-19",
    ]);
    expect(c.epics).toEqual([
      { key: "PROJ-1", buffer: 3 },
      { key: "PROJ-2", buffer: 0 },
      { key: "PROJ-3", buffer: 8 },
    ]);
  });

  it("throws on zero buffer (PROJ-1+0)", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--when", "--epics", "PROJ-1+0", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
      ])
    ).toThrow(/buffer.*positive/i);
  });

  it("throws on non-integer buffer (PROJ-1+1.5)", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--when", "--epics", "PROJ-1+1.5", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
      ])
    ).toThrow(/buffer.*positive/i);
  });

  it("throws on non-numeric buffer (PROJ-1+abc)", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--when", "--epics", "PROJ-1+abc", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
      ])
    ).toThrow(/buffer.*positive/i);
  });

  it("throws when --exclude-epic-types is given without --epics", () => {
    withJiraEnv();
    expect(() =>
      parseConfig([
        "--when", "--tickets", "30", "--project", "MYPROJ",
        "--from", "2026-06-06", "--to", "2026-06-19",
        "--exclude-epic-types", "Task,Spike",
      ])
    ).toThrow(/--exclude-epic-types requires --epics/i);
  });
});

describe("--workday", () => {
  beforeEach(() => {
    process.env.WD_JSON_LINK = "https://wd.example.com/report?MyDateFrom=2026-01-01&MyDateTo=2026-12-31&format=json";
    process.env.WD_USER = "user";
    process.env.WD_PASSWORD = "pass";
    process.env.WD_FIELD_ENTRIES = "Report_Entry";
    process.env.WD_FIELD_WORKER = "Worker";
    process.env.WD_FIELD_DATE_FROM = "From";
    process.env.WD_FIELD_DATE_TO = "To";
    process.env.WD_PARAM_DATE_FROM = "MyDateFrom";
    process.env.WD_PARAM_DATE_TO = "MyDateTo";
    process.env.JIRA_URL = "https://jira.example.com";
    process.env.JIRA_EMAIL = "a@b.com";
    process.env.JIRA_TOKEN = "tok";
    process.env.MCF_JIRA_TYPES = "Bug,Story,Task";
  });

  afterEach(() => {
    delete process.env.WD_JSON_LINK;
    delete process.env.WD_USER;
    delete process.env.WD_PASSWORD;
    delete process.env.WD_EXCLUDE_WORKERS;
    delete process.env.WD_FIELD_ENTRIES;
    delete process.env.WD_FIELD_WORKER;
    delete process.env.WD_FIELD_DATE_FROM;
    delete process.env.WD_FIELD_DATE_TO;
    delete process.env.WD_PARAM_DATE_FROM;
    delete process.env.WD_PARAM_DATE_TO;
  });

  it("parses --workday with required --team-size", () => {
    const cfg = parseConfig([
      "--how-many", "--days", "30",
      "--project", "KEY",
      "--workday", "--team-size", "8",
    ]);
    expect(cfg.workday).toBeDefined();
    expect(cfg.workday!.teamSize).toBe(8);
    expect(cfg.workday!.joiners).toEqual([]);
    expect(cfg.workday!.leavers).toEqual([]);
    expect(cfg.workday!.wdConfig.fields).toEqual({ entries: "Report_Entry", worker: "Worker", dateFrom: "From", dateTo: "To" });
    expect(cfg.workday!.wdConfig.dateParams).toEqual({ from: "MyDateFrom", to: "MyDateTo" });
  });

  it("accepts decimal --team-size", () => {
    const cfg = parseConfig([
      "--how-many", "--days", "30", "--project", "KEY",
      "--workday", "--team-size", "7.65",
    ]);
    expect(cfg.workday!.teamSize).toBeCloseTo(7.65);
  });

  it("rejects --workday without --team-size", () => {
    expect(() =>
      parseConfig(["--how-many", "--days", "30", "--project", "KEY", "--workday"])
    ).toThrow("--workday requires --team-size");
  });

  it("rejects --workday with --when mode", () => {
    expect(() =>
      parseConfig([
        "--when", "--tickets", "20", "--project", "KEY",
        "--workday", "--team-size", "8",
      ])
    ).toThrow("--workday is only valid with --how-many");
  });

  it("rejects --workday and --headcount together", () => {
    expect(() =>
      parseConfig([
        "--how-many", "--days", "30", "--project", "KEY",
        "--workday", "--team-size", "8", "--headcount", "8,7",
      ])
    ).toThrow("--workday and --headcount are mutually exclusive");
  });

  it("parses --leaver and --joiner dates", () => {
    const cfg = parseConfig([
      "--how-many", "--days", "30", "--project", "KEY",
      "--workday", "--team-size", "8",
      "--leaver", "2026-07-01",
      "--joiner", "2026-08-15",
    ]);
    expect(cfg.workday!.leavers).toEqual(["2026-07-01"]);
    expect(cfg.workday!.joiners).toEqual(["2026-08-15"]);
  });

  it("rejects --leaver without --workday", () => {
    expect(() =>
      parseConfig([
        "--how-many", "--days", "30", "--throughput", "3,4,5",
        "--leaver", "2026-07-01",
      ])
    ).toThrow("--leaver requires --workday");
  });

  it("rejects --joiner without --workday", () => {
    expect(() =>
      parseConfig([
        "--how-many", "--days", "30", "--throughput", "3,4,5",
        "--joiner", "2026-07-01",
      ])
    ).toThrow("--joiner requires --workday");
  });

  it("reads WD_EXCLUDE_WORKERS from env", () => {
    process.env.WD_EXCLUDE_WORKERS = "Peter Seidel,Jane Doe";
    const cfg = parseConfig([
      "--how-many", "--days", "30", "--project", "KEY",
      "--workday", "--team-size", "8",
    ]);
    expect(cfg.workday!.wdConfig.excludeWorkers).toEqual(["Peter Seidel", "Jane Doe"]);
  });

  it.each([
    "WD_JSON_LINK",
    "WD_FIELD_ENTRIES",
    "WD_FIELD_WORKER",
    "WD_FIELD_DATE_FROM",
    "WD_FIELD_DATE_TO",
    "WD_PARAM_DATE_FROM",
    "WD_PARAM_DATE_TO",
  ])("rejects --workday when %s is missing", (envVar) => {
    process.env[envVar] = "";
    expect(() =>
      parseConfig([
        "--how-many", "--days", "30", "--project", "KEY",
        "--workday", "--team-size", "8",
      ])
    ).toThrow(`${envVar} is required`);
  });

  it("rejects invalid --leaver date", () => {
    expect(() =>
      parseConfig([
        "--how-many", "--days", "30", "--project", "KEY",
        "--workday", "--team-size", "8",
        "--leaver", "not-a-date",
      ])
    ).toThrow("--leaver must be a valid date");
  });
});

describe("--forecast-from", () => {
  it("defaults to today when not specified", () => {
    const today = new Date().toISOString().slice(0, 10);
    const cfg = parseConfig(["--how-many", "--days", "30", "--throughput", "3,4,5"]);
    expect(cfg.forecastFrom).toBe(today);
  });

  it("accepts a valid date", () => {
    const cfg = parseConfig([
      "--how-many", "--days", "30", "--throughput", "3,4,5",
      "--forecast-from", "2026-09-01",
    ]);
    expect(cfg.forecastFrom).toBe("2026-09-01");
  });

  it("rejects an invalid date", () => {
    expect(() =>
      parseConfig([
        "--how-many", "--days", "30", "--throughput", "3,4,5",
        "--forecast-from", "not-a-date",
      ])
    ).toThrow("--forecast-from must be a valid date");
  });

  it("works with --when mode", () => {
    const cfg = parseConfig([
      "--when", "--tickets", "20", "--throughput", "3,4,5",
      "--forecast-from", "2026-09-01",
    ]);
    expect(cfg.forecastFrom).toBe("2026-09-01");
  });
});

describe("MCF_DEFAULT_PROJECT + --throughput priority", () => {
  beforeEach(() => {
    process.env.MCF_DEFAULT_PROJECT = "KEY";
  });

  it("--throughput wins silently when MCF_DEFAULT_PROJECT is set", () => {
    // Should NOT throw — --throughput takes priority over the env default.
    const cfg = parseConfig(["--how-many", "--days", "10", "--throughput", "2,4,6"]);
    expect(cfg.throughput).toEqual([2, 4, 6]);
    expect(cfg.jira).toBeUndefined();
  });

  it("still errors when both --throughput and explicit --project are typed", () => {
    process.env.JIRA_URL = "https://jira.example.com";
    process.env.JIRA_EMAIL = "a@b.com";
    process.env.JIRA_TOKEN = "tok";
    process.env.MCF_JIRA_TYPES = "Story,Bug";
    expect(() =>
      parseConfig([
        "--how-many", "--days", "10",
        "--throughput", "2,4,6",
        "--project", "KEY",
      ])
    ).toThrow("mutually exclusive");
  });
});

describe("--tsv flag", () => {
  beforeEach(() => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "user@test.com";
    process.env.JIRA_TOKEN = "tok";
    process.env.MCF_JIRA_TYPES = "Bug,Story,Task";
  });

  it("parses --tsv as true", () => {
    const c = parseConfig([
      "--when", "--epics", "PROJ-1", "--project", "PROJ",
      "--from", "2026-06-01", "--to", "2026-06-19", "--tsv",
    ]);
    expect(c.tsv).toBe(true);
  });

  it("defaults tsv to false when omitted", () => {
    const c = parseConfig([
      "--when", "--epics", "PROJ-1", "--project", "PROJ",
      "--from", "2026-06-01", "--to", "2026-06-19",
    ]);
    expect(c.tsv).toBe(false);
  });

  it("throws when --tsv is used without --epics", () => {
    expect(() =>
      parseConfig([
        "--when", "--tickets", "10", "--project", "PROJ",
        "--from", "2026-06-01", "--to", "2026-06-19", "--tsv",
      ])
    ).toThrow(/--tsv.*--when.*--epics/i);
  });

  it("throws when --tsv and --json are both set", () => {
    expect(() =>
      parseConfig([
        "--when", "--epics", "PROJ-1", "--project", "PROJ",
        "--from", "2026-06-01", "--to", "2026-06-19", "--tsv", "--json",
      ])
    ).toThrow(/--tsv.*--json/i);
  });
});
