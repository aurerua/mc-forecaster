#!/usr/bin/env bun
import { parseConfig, MissingJiraTypesError } from "./args";
import { fetchThroughput, buildJql, fetchEpicCounts, fetchProjectIssueTypes } from "./jira";
import { forecast, forecastEpics } from "./run";
import { formatHuman, formatJson, formatEpicsHuman, formatEpicsTsv } from "./format";
import { bold, dim } from "./ansi";
import { fetchVacations, avgAvailable, addDaysToYMD, addWorkingDaysToYMD } from "./workday";

const COL = 30;
const heading = (title: string) => `\n${bold(title)}`;
const row = (flag: string, desc: string) => `  ${flag.padEnd(COL - 2)}${desc}`;

const USAGE = [
  "Monte Carlo forecasting for ticket throughput (manual or from Jira).",

  heading("Modes (pick one)"),
  row("--how-many --days N", "How many tickets finish in N days?"),
  row("--when --tickets T", "When do T tickets finish?"),
  row("--when --epics KEY1,KEY2+N", "When do these epics finish? (Jira only;"),
  row("", "+N adds N buffer tickets on top of an"),
  row("", "epic's live count)"),

  heading("Throughput source (pick one)"),
  row("--throughput a,b,c", "Manual daily throughput samples"),
  row("--project KEY", "Fetch throughput from Jira (requires"),
  row("", "JIRA_URL, JIRA_EMAIL, JIRA_TOKEN,"),
  row("", "MCF_JIRA_TYPES in ~/.config/mcf/env)"),

  heading("Jira history window (with --project)"),
  row("--from YYYY-MM-DD", "Start of history (default: 90 days ago)"),
  row("--to YYYY-MM-DD", "End of history (default: yesterday)"),
  row("--exclude-types t1,t2", "Drop issue types from MCF_JIRA_TYPES"),
  row("--exclude-resolutions r1,r2", "Drop resolutions from the count"),
  row("--exclude-weekends", "Count working days only"),
  row("--no-cache", "Bypass the local Jira response cache"),

  heading("Jira debug output (with --project)"),
  row("--show-jql", "Print the JQL query used"),
  row("--show-types", "Print issue-type breakdown"),
  row("--show-resolutions", "Print resolution breakdown"),
  row("--show-throughput", "Print the derived daily throughput series"),

  heading("Epic scope (with --when --epics)"),
  row("--exclude-epic-types t1,t2", "Drop issue types when counting epic scope"),
  row("--tsv", "One row per epic (TSV) instead of prose"),

  heading("Workday capacity (with --how-many --project)"),
  row("--workday", "Scale capacity using Workday vacation data"),
  row("--team-size N", "Team size (required with --workday)"),
  row("--leaver YYYY-MM-DD", "Person leaving on this date (repeatable)"),
  row("--joiner YYYY-MM-DD", "Person joining on this date (repeatable)"),

  heading("Simulation & output"),
  row("--runs R", "Monte Carlo run count (default: 10000)"),
  row("--headcount D,F", "Scale throughput by headcount ratio (data,forecast)"),
  row("--forecast-from DATE", "Forecast start date (default: today)"),
  row("--json", "Output JSON instead of prose"),

  heading("Examples"),
  "  mcf --how-many --days 10 --throughput 3,5,2,4,6",
  "  mcf --when --tickets 40 --project ENG --exclude-weekends",
  "  mcf --how-many --days 15 --project ENG --workday --team-size 8 --leaver 2026-07-10",
  "  mcf --when --epics ENG-100,ENG-200+5 --project ENG --tsv",
].join("\n");

/** Print guidance when MCF_JIRA_TYPES is unset, including the project's issue
 *  types (queried from Jira) ready to paste into ~/.config/mcf/env. */
async function reportMissingJiraTypes(err: MissingJiraTypesError): Promise<void> {
  console.error(`Error: ${err.message}`);
  try {
    const types = await fetchProjectIssueTypes(err.conn);
    if (types.length > 0) {
      console.error(`\nIssue types in project ${err.conn.project} — add to ~/.config/mcf/env:`);
      console.error(`  MCF_JIRA_TYPES=${types.join(",")}`);
      console.error(`\n(remove any you don't want to count, e.g. Epic.)`);
      return;
    }
  } catch (e) {
    console.error(`(could not list project issue types: ${(e as Error).message})`);
  }
  console.error(`\nSet MCF_JIRA_TYPES to your project's issue types, e.g.:`);
  console.error(`  MCF_JIRA_TYPES=Bug,Story,Task`);
}

async function main(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  if (argv.includes("--version")) {
    console.log("1.0.0");
    process.exit(0);
  }

  let cfg;
  try {
    cfg = parseConfig(argv);
  } catch (err) {
    if (err instanceof MissingJiraTypesError) {
      await reportMissingJiraTypes(err);
      process.exit(1);
    }
    console.error(`Error: ${(err as Error).message}`);
    console.error(`\n${USAGE}`);
    process.exit(1);
  }

  let throughputLabel: string | undefined;
  const runDate = new Date().toISOString().slice(0, 10);

  if (cfg.jira) {
    if (cfg.showJql && process.stdout.isTTY) {
      console.log(`${bold("JQL:")}\n${dim(buildJql(cfg.jira))}\n`);
    }
    try {
      const result = await fetchThroughput(cfg.jira);
      cfg.throughput = result.throughput;
      if (cfg.showTypes && process.stdout.isTTY) {
        const cats = Object.entries(result.categories).sort((a, b) => b[1] - a[1]);
        console.log(bold("Types:"));
        for (const [name, count] of cats) console.log(`${name}: ${count}`);
        console.log("");
      }
      if (cfg.showResolutions && process.stdout.isTTY) {
        const res = Object.entries(result.resolutions).sort((a, b) => b[1] - a[1]);
        console.log(bold("Resolutions:"));
        for (const [name, count] of res) console.log(`${name}: ${count}`);
        console.log("");
      }
      if (cfg.showThroughput && process.stdout.isTTY) {
        console.log(bold("Throughput (daily):"));
        console.log(cfg.throughput.join(","));
        console.log("");
      }
      if ((cfg.showJql || cfg.showTypes || cfg.showResolutions || cfg.showThroughput) && process.stdout.isTTY) {
        console.log("─".repeat(40));
        console.log("");
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    const days = cfg.throughput.length;
    const total = cfg.throughput.reduce((a, b) => a + b, 0);
    const dayUnit = cfg.jira.excludeWeekends ? "working days" : "days";
    throughputLabel = `fetched from Jira (${cfg.jira.project}, ${cfg.jira.from} – ${cfg.jira.to}, ${total} tickets across ${days} ${dayUnit})`;
  }

  if (cfg.workday) {
    const { wdConfig, teamSize, joiners, leavers } = cfg.workday;
    const excludeWeekends = cfg.jira?.excludeWeekends ?? false;

    const dataFrom = cfg.jira?.from;
    const dataTo = cfg.jira?.to;
    if (!dataFrom || !dataTo) {
      console.error("Error: --workday requires --project (Jira data source).");
      process.exit(1);
    }

    const forecastTo = excludeWeekends
      ? addWorkingDaysToYMD(cfg.forecastFrom, cfg.days! - 1)
      : addDaysToYMD(cfg.forecastFrom, cfg.days! - 1);

    let historicalVacations, forecastVacations;
    try {
      [historicalVacations, forecastVacations] = await Promise.all([
        fetchVacations(wdConfig, dataFrom, dataTo),
        fetchVacations(wdConfig, cfg.forecastFrom, forecastTo),
      ]);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }

    const avgData = avgAvailable(historicalVacations, teamSize, joiners, leavers, dataFrom, dataTo, excludeWeekends);
    const avgForecast = avgAvailable(forecastVacations, teamSize, joiners, leavers, cfg.forecastFrom, forecastTo, excludeWeekends);

    cfg.headcount = { data: avgData, forecast: avgForecast };
    cfg.workdayHeadcount = true;
  }

  if (cfg.epics) {
    let epicCounts;
    try {
      const epicKeys = cfg.epics.map((e) => e.key);
      const rawCounts = await fetchEpicCounts(cfg.jira!, epicKeys, cfg.epicTypes!);
      epicCounts = rawCounts.map((ec, i) => ({ ...ec, buffer: cfg.epics![i].buffer }));
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    const result = forecastEpics(cfg, epicCounts);
    const forecastStart = new Date(cfg.forecastFrom + "T12:00:00Z");
    const excludeWeekends = cfg.jira?.excludeWeekends ?? false;
    if (cfg.tsv) {
      console.log(formatEpicsTsv(result, runDate, forecastStart, excludeWeekends));
    } else {
      console.log(formatEpicsHuman(result, throughputLabel, forecastStart, excludeWeekends, runDate));
    }
    return;
  }

  const result = forecast(cfg);
  console.log(cfg.json ? formatJson(result) : formatHuman(result, throughputLabel, runDate));
}

main(process.argv.slice(2));
