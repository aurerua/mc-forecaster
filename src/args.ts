import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseTP } from "./lib";
import type { SimMode } from "./lib";
import type { JiraConfig } from "./jira";

export type { JiraConfig };

export interface Headcount {
  data: number;
  forecast: number;
}

export interface WorkdayInputConfig {
  wdConfig: {
    jsonLink: string;
    user: string;
    password: string;
    excludeWorkers: string[];
    noCache: boolean;
  };
  teamSize: number;
  joiners: string[];
  leavers: string[];
}

export interface EpicSpec {
  key: string;
  buffer: number;
}

export interface ForecastConfig {
  mode: SimMode;
  throughput: number[];   // [] when jira is set; populated by cli.ts before forecast()
  jira?: JiraConfig;
  runs: number;
  days?: number;
  tickets?: number;
  epics?: EpicSpec[];
  epicTypes?: string[];  // resolved epic work types (universe minus --exclude-epic-types)
  headcount?: Headcount;
  workday?: WorkdayInputConfig;
  workdayHeadcount?: boolean;  // set by cli.ts after WD computation
  json: boolean;
  tsv: boolean;
  showJql?: boolean;
  showTypes?: boolean;
  showResolutions?: boolean;
  showThroughput?: boolean;
  forecastFrom: string;
}

export interface JiraConn {
  baseUrl: string;
  email: string;
  token: string;
  project: string;
}

/** Thrown on a Jira run when MCF_JIRA_TYPES is unset. Carries the connection so
 *  the CLI can query Jira for the project's issue types and show them. */
export class MissingJiraTypesError extends Error {
  constructor(public conn: JiraConn) {
    super("MCF_JIRA_TYPES is not set — add it to ~/.config/mcf/env.");
    this.name = "MissingJiraTypesError";
  }
}

function splitCsv(raw: string | undefined): string[] {
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Warn (don't fail) when an excluded type isn't in the universe — a typo would
 *  otherwise silently exclude nothing and skew the forecast. */
function warnUnknownExclusions(excluded: string[], universe: string[], flag: string): void {
  for (const t of excluded) {
    if (!universe.includes(t)) {
      console.error(`Warning: ${flag} value "${t}" is not in MCF_JIRA_TYPES (ignored).`);
    }
  }
}

function parseEnvValue(raw: string): string {
  const v = raw.trim();
  // Quoted values are taken literally (allows '#' or spaces inside).
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  // Unquoted: strip an inline comment (whitespace followed by '#'), per dotenv convention.
  return v.replace(/\s+#.*$/, "").trim();
}

function loadMcsEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  try {
    const content = readFileSync(join(homedir(), ".config", "mcf", "env"), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      base[trimmed.slice(0, eq).trim()] = parseEnvValue(trimmed.slice(eq + 1));
    }
  } catch { /* file absent is fine */ }
  return { ...base, ...(process.env as Record<string, string>) };
}

function parseEpicSpec(raw: string): EpicSpec {
  const plusIdx = raw.lastIndexOf("+");
  if (plusIdx === -1) return { key: raw, buffer: 0 };
  const key = raw.slice(0, plusIdx);
  const bufRaw = raw.slice(plusIdx + 1);
  const buf = Number(bufRaw);
  if (!Number.isInteger(buf) || buf <= 0) {
    throw new Error(`Epic buffer must be a positive integer (got "${bufRaw}" in "${raw}").`);
  }
  return { key, buffer: buf };
}

function requirePositiveNumber(raw: string, flag: string): number {
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number (got "${raw}").`);
  return n;
}

function requirePositiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer (got "${raw}").`);
  return n;
}

function parseHeadcount(raw: string): Headcount {
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.length !== 2) throw new Error(`--headcount must be "data,forecast" (got "${raw}").`);
  const data = Number(parts[0]);
  const forecast = Number(parts[1]);
  if (!isFinite(data) || data <= 0 || !isFinite(forecast) || forecast <= 0) {
    throw new Error(`--headcount values must be two positive numbers (got "${raw}").`);
  }
  return { data, forecast };
}

function requireValidDate(raw: string, flag: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(Date.parse(raw))) {
    throw new Error(`${flag} must be a valid date in YYYY-MM-DD format (got "${raw}").`);
  }
  return raw;
}

function daysAgoYMD(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function parseConfig(argv: string[]): ForecastConfig {
  const env = loadMcsEnv();

  const { values } = parseArgs({
    args: argv,
    options: {
      "how-many":         { type: "boolean" },
      when:               { type: "boolean" },
      throughput:         { type: "string" },
      project:            { type: "string" },
      from:               { type: "string" },
      to:                 { type: "string" },
      "exclude-types":    { type: "string" },
      "exclude-resolutions": { type: "string" },
      "exclude-weekends": { type: "boolean" },
      "no-cache":         { type: "boolean" },
      "show-jql":         { type: "boolean" },
      "show-types":       { type: "boolean" },
      "show-resolutions": { type: "boolean" },
      "show-throughput":  { type: "boolean" },
      days:               { type: "string" },
      tickets:            { type: "string" },
      epics:              { type: "string" },
      "exclude-epic-types": { type: "string" },
      runs:               { type: "string" },
      headcount:          { type: "string" },
      workday:            { type: "boolean" },
      "team-size":        { type: "string" },
      leaver:             { type: "string", multiple: true },
      joiner:             { type: "string", multiple: true },
      json:               { type: "boolean" },
      tsv:                { type: "boolean" },
      "forecast-from":    { type: "string" },
    },
    allowPositionals: false,
  });

  // Mode
  if (values["how-many"] && values.when) throw new Error("Specify only one of --how-many or --when.");
  if (!values["how-many"] && !values.when) throw new Error("Specify a mode: --how-many or --when.");
  const mode: SimMode = values["how-many"] ? "howmany" : "when";

  // Throughput source
  const hasManual = Boolean(values.throughput?.trim());
  // Only fall back to MCF_DEFAULT_PROJECT when --throughput is absent.
  const projectRaw = values.project ?? (!hasManual ? (env.MCF_DEFAULT_PROJECT || undefined) : undefined);
  const hasJira = Boolean(projectRaw);

  if (hasManual && values.project) {
    throw new Error("--throughput and --project are mutually exclusive.");
  }
  if (!hasManual && !hasJira) {
    throw new Error("Provide a throughput source: --throughput <values> or --project <key>.");
  }

  // Shared forecast params
  const runs = values.runs == null ? 10000 : requirePositiveInt(values.runs, "--runs");
  const days = values.days == null ? undefined : requirePositiveNumber(values.days, "--days");
  const tickets = values.tickets == null ? undefined : requirePositiveNumber(values.tickets, "--tickets");

  if (mode === "howmany" && days == null) throw new Error("--how-many requires --days.");

  // Epics / tickets
  const epicsRaw = values.epics;
  const epics = epicsRaw
    ? epicsRaw.split(",").map((s) => s.trim()).filter(Boolean).map(parseEpicSpec)
    : undefined;
  const epicExcludeRaw = values["exclude-epic-types"];

  if (epics != null && epics.length === 0) {
    throw new Error('--epics must contain at least one key (got empty value).');
  }
  if (epicExcludeRaw != null && epics == null) {
    throw new Error('--exclude-epic-types requires --epics.');
  }

  if (tickets != null && epics != null) {
    throw new Error("--tickets and --epics are mutually exclusive.");
  }
  if (epics != null && mode !== "when") {
    throw new Error("--epics is only valid with --when.");
  }
  if (epics != null && !hasJira) {
    throw new Error("--epics requires a Jira project (--project or MCF_DEFAULT_PROJECT).");
  }
  if (mode === "when" && tickets == null && epics == null) {
    throw new Error("--when requires --tickets or --epics.");
  }

  if (values.tsv && epics == null) {
    throw new Error("--tsv is only valid with --when --epics.");
  }
  if (values.tsv && values.json) {
    throw new Error("--tsv and --json are mutually exclusive.");
  }

  const headcount = values.headcount == null ? undefined : parseHeadcount(values.headcount);
  const showJql = Boolean(values["show-jql"]);
  const showTypes = Boolean(values["show-types"]);
  const showResolutions = Boolean(values["show-resolutions"]);
  const showThroughput = Boolean(values["show-throughput"]);

  const hasWorkday = Boolean(values.workday);
  const hasLeaver = (values.leaver ?? []).length > 0;
  const hasJoiner = (values.joiner ?? []).length > 0;

  if (hasWorkday && headcount) throw new Error("--workday and --headcount are mutually exclusive.");
  if (hasWorkday && mode !== "howmany") throw new Error("--workday is only valid with --how-many.");
  if (hasLeaver && !hasWorkday) throw new Error("--leaver requires --workday.");
  if (hasJoiner && !hasWorkday) throw new Error("--joiner requires --workday.");

  let workday: WorkdayInputConfig | undefined;
  if (hasWorkday) {
    if (!values["team-size"]) throw new Error("--workday requires --team-size.");
    const teamSize = Number(values["team-size"]);
    if (!isFinite(teamSize) || teamSize <= 0) {
      throw new Error("--team-size must be a positive number.");
    }

    const wdLink = env.WD_JSON_LINK;
    const wdUser = env.WD_USER;
    const wdPassword = env.WD_PASSWORD;
    if (!wdLink) throw new Error("WD_JSON_LINK is required — set it in ~/.config/mcf/env or as an env var.");
    if (!wdUser) throw new Error("WD_USER is required — set it in ~/.config/mcf/env or as an env var.");
    if (!wdPassword) throw new Error("WD_PASSWORD is required — set it in ~/.config/mcf/env or as an env var.");

    const excludeWorkersRaw = env.WD_EXCLUDE_WORKERS ?? "";
    const excludeWorkers = excludeWorkersRaw
      ? excludeWorkersRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    const leavers = (values.leaver ?? []).map((d) => requireValidDate(d, "--leaver"));
    const joiners = (values.joiner ?? []).map((d) => requireValidDate(d, "--joiner"));

    workday = {
      wdConfig: {
        jsonLink: wdLink,
        user: wdUser,
        password: wdPassword,
        excludeWorkers,
        noCache: Boolean(values["no-cache"]),
      },
      teamSize,
      joiners,
      leavers,
    };
  }

  const forecastFromRaw = values["forecast-from"] ?? new Date().toISOString().slice(0, 10);
  const forecastFrom = requireValidDate(forecastFromRaw, "--forecast-from");

  // Manual path
  if (hasManual) {
    const throughput = parseTP(values.throughput!);
    if (throughput.length === 0) throw new Error("--throughput must contain at least one valid number.");
    return { mode, throughput, runs, days, tickets, epics, epicTypes: undefined, headcount, workday, json: Boolean(values.json), tsv: Boolean(values.tsv), showJql, showTypes, showResolutions, showThroughput, forecastFrom };
  }

  // Jira path — validate credentials
  const jiraUrl = env.JIRA_URL;
  const jiraEmail = env.JIRA_EMAIL;
  const jiraToken = env.JIRA_TOKEN;
  if (!jiraUrl) throw new Error("JIRA_URL is required — set it in ~/.config/mcf/env or as an env var.");
  if (!jiraEmail) throw new Error("JIRA_EMAIL is required — set it in ~/.config/mcf/env or as an env var.");
  if (!jiraToken) throw new Error("JIRA_TOKEN is required — set it in ~/.config/mcf/env or as an env var.");

  const fromRaw = values.from ?? daysAgoYMD(90);
  const toRaw = values.to ?? daysAgoYMD(1);
  const from = requireValidDate(fromRaw, "--from");
  const to = requireValidDate(toRaw, "--to");
  if (from > to) throw new Error("--from must not be after --to.");

  // Type universe — required on the Jira path; no built-in default.
  const universe = splitCsv(env.MCF_JIRA_TYPES);
  if (universe.length === 0) {
    throw new MissingJiraTypesError({ baseUrl: jiraUrl, email: jiraEmail, token: jiraToken, project: projectRaw! });
  }

  const excluded = splitCsv(values["exclude-types"]);
  warnUnknownExclusions(excluded, universe, "--exclude-types");
  const types = universe.filter((t) => !excluded.includes(t));
  if (types.length === 0) throw new Error("--exclude-types removed every type; nothing left to count.");

  // Resolutions are free-form (no env universe) and opt-in; pass through as given.
  const excludeResolutions = splitCsv(values["exclude-resolutions"]);

  // Epic types anchor independently to the same universe.
  let epicTypes: string[] | undefined;
  if (epics != null) {
    const epicExcluded = splitCsv(epicExcludeRaw);
    warnUnknownExclusions(epicExcluded, universe, "--exclude-epic-types");
    epicTypes = universe.filter((t) => !epicExcluded.includes(t));
    if (epicTypes.length === 0) throw new Error("--exclude-epic-types removed every type; nothing left to count.");
  }

  const jira: JiraConfig = {
    baseUrl: jiraUrl,
    email: jiraEmail,
    token: jiraToken,
    project: projectRaw!,
    from,
    to,
    types,
    excludeResolutions,
    excludeWeekends: Boolean(values["exclude-weekends"]),
    noCache: Boolean(values["no-cache"]),
  };

  return { mode, throughput: [], jira, runs, days, tickets, epics, epicTypes, headcount, workday, json: Boolean(values.json), tsv: Boolean(values.tsv), showJql, showTypes, showResolutions, showThroughput, forecastFrom };
}
