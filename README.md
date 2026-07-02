# Monte Carlo Simulations

[![CI](https://github.com/aureliengiraud/mc-forecaster/actions/workflows/ci.yml/badge.svg)](https://github.com/aureliengiraud/mc-forecaster/actions/workflows/ci.yml)

`mcf` — Monte Carlo forecasting tool for the terminal. Feed it historical
throughput (by hand or fetched from Jira) and it answers two questions:

- **How many** items will we ship in N days?
- **When** will we finish T items (or a sequence of epics)?

No build step — [Bun](https://bun.sh) runs the TypeScript directly. Simulation
logic lives in [`src/lib`](src/lib); CLI wiring is in [`src/cli.ts`](src/cli.ts).

## Installation

```bash
bun install
bun link      # makes `mcf` available globally (points at src/cli.ts)
```

## Throughput sources

`mcf` needs historical throughput data to run a simulation. Supply it one of two ways:

**Manual** — pass comma-separated daily counts directly:
```bash
mcf --how-many --days 10 --throughput 2,4,6,7,3,4,9,7,7,6
```

**Jira Cloud** — fetch automatically from a project (see [Jira setup](#jira-setup)):
```bash
mcf --how-many --days 10 --project PROJ --from 2026-05-01 --to 2026-06-19
```

## Modes

### `--how-many` — items shipped in N days

```bash
mcf --how-many --days 10 --throughput 2,4,6,7,3,4,9,7,7,6
```

### `--when` — days to finish N tickets

```bash
mcf --when --tickets 50 --throughput 2,4,6,7,3,4,9,7,7,6
```

### `--when --epics` — sequential epic forecasting

Forecast when a series of epics will finish, chaining them in sequence. Each epic's start depends on the previous one finishing. Produces per-epic finish dates plus a global completion date.

```bash
mcf --when --epics PROJ-1,PROJ-2,PROJ-3 --project PROJ --from 2026-03-01 --to 2026-06-20
```

Open ticket counts per epic are fetched from Jira automatically. Requires `--project` (or `MCF_DEFAULT_PROJECT`).

Append `+N` to any epic key to add N buffer tickets on top of its live Jira count — useful when you know more work is coming but the tickets aren't created yet:

```bash
mcf --when --epics PROJ-1+4,PROJ-2,PROJ-3+10 --project PROJ --from 2026-03-01 --to 2026-06-20
```

#### TSV output

`--tsv` outputs one tab-separated row per epic (no header). Paste directly into Google Sheets — columns split automatically on paste.

| # | Column | Content |
|---|--------|---------|
| 1 | Date | Run date — `DD.MM.YYYY` |
| 2 | Ticket ID | Epic key (e.g. `PROJ-1`) |
| 3 | Open | Live open ticket count from Jira (excludes buffer) |
| 4 | Buffer | Buffer added via `+N` syntax (0 if none) |
| 5 | P95 days | Duration at 95% confidence (the "X days" in human output) |
| 6 | P85 days | Duration at 85% confidence |
| 7 | P70 days | Duration at 70% confidence |
| 8 | P50 days | Duration at 50% confidence (median) |
| 9 | P95 finish | Cumulative finish date at 95% confidence — `YYYY-MM-DD` |
| 10 | P85 finish | Cumulative finish date at 85% confidence |
| 11 | P70 finish | Cumulative finish date at 70% confidence |
| 12 | P50 finish | Cumulative finish date at 50% confidence (median) |

To add a header row to your tracking file, copy this line (tabs preserved):

```
Date	Ticket ID	Open	Buffer	P95 days	P85 days	P70 days	P50 days	P95 finish	P85 finish	P70 finish	P50 finish
```


## Flags

### Simulation

| Flag | Required | Description |
|------|----------|-------------|
| `--how-many` | one of | Forecast items shipped in N days |
| `--when` | one of | Forecast days to finish N tickets or a sequence of epics |
| `--days N` | with `--how-many` | Sprint length in days |
| `--tickets N` | with `--when` | Backlog size (mutually exclusive with `--epics`) |
| `--epics K1,K2` | with `--when` | Comma-separated epic keys to forecast in sequence (requires `--project`); append `+N` to any key to add N buffer tickets on top of its live count (e.g. `PROJ-1+4`) |
| `--exclude-epic-types t1,t2` | with `--epics` | Work types to drop from per-epic child counts (anchored to `MCF_JIRA_TYPES`, independent of `--exclude-types`) |
| `--runs N` | | Simulation count (default: 10,000) |
| `--headcount D,F` | | Team size: D at data time, F at forecast time (scales throughput). Mutually exclusive with `--workday`. |
| `--workday` | | Fetch vacation data from Workday to compute capacity ratio automatically (see [Workday setup](#workday-setup)). `--how-many` only. |
| `--team-size N` | with `--workday` | Team headcount at the **start of the data period** (required with `--workday`). Accepts decimals (e.g. `6.5` for a part-time member). |
| `--leaver YYYY-MM-DD` | with `--workday` | Date a team member left (reduces effective headcount from that day onward). Repeatable. |
| `--joiner YYYY-MM-DD` | with `--workday` | Date a new team member joined (increases effective headcount from that day onward). Repeatable. |
| `--forecast-from YYYY-MM-DD` | | Start date for the forecast window (default: today). Works with both `--how-many` and `--when`. |
| `--json` | | Output JSON instead of human-readable text |
| `--tsv` | with `--when --epics` | Output tab-separated rows (one per epic) instead of human-readable text. No header row — see [TSV output](#tsv-output) |

### Throughput — manual

| Flag | Required | Description |
|------|----------|-------------|
| `--throughput a,b,c` | if no `--project` | Historical throughput (items/day), comma-separated |

### Throughput — Jira fetch

| Flag | Required | Description |
|------|----------|-------------|
| `--project KEY` | if no `--throughput` | Jira project key |
| `--from YYYY-MM-DD` | | Range start (default: 90 days ago) |
| `--to YYYY-MM-DD` | | Range end (default: yesterday) |
| `--exclude-types t1,t2` | | Work types to drop from the count. The full set comes from `MCF_JIRA_TYPES` (required, see [Jira setup](#jira-setup)); this subtracts from it. |
| `--exclude-resolutions r1,r2` | | Resolutions to drop from the count via `resolution NOT IN (...)`, e.g. `"Won't Do,Won't Fix"`. Opt-in and free-form (not anchored to `MCF_JIRA_TYPES`); Done tickets resolved this way otherwise inflate throughput. |
| `--exclude-weekends` | | Drop Saturday and Sunday from throughput samples |
| `--no-cache` | | Force-refresh cache for this query (delete existing entry, re-fetch, write fresh data) |
| `--show-jql` | | Print the JQL query before fetching |
| `--show-types` | | Print the issue type breakdown of fetched tickets (helps spot what to `--exclude-types`) |
| `--show-resolutions` | | Print the resolution breakdown of fetched tickets (helps spot what to `--exclude-resolutions`) |
| `--show-throughput` | | Print the daily throughput series fetched from Jira |

`--throughput` and `--project` are mutually exclusive.

## Jira setup

**1. Create a scoped API token**

Go to [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens), create a token with the `read:jira-work` scope.

**2. Create `~/.config/mcf/env`**

```bash
JIRA_URL=https://yourcompany.atlassian.net
JIRA_EMAIL=you@yourcompany.com
JIRA_TOKEN=your-api-token

# Optional defaults
MCF_DEFAULT_PROJECT=MYPROJECT

# Required for Jira runs: every issue type your org uses (the "universe").
# --exclude-types / --exclude-epic-types subtract from this. If unset, mcf
# errors and lists your project's issue types so you can paste them here.
MCF_JIRA_TYPES=Bug,Story,Task
```

See [`env.example`](env.example) for the full list of options.

**Caching:** fetched issue lists are cached in `~/.cache/mcf/` indefinitely for past date ranges. Use `--no-cache` to force-refresh: delete the cached entry for this query, fetch from Jira, then repopulate the cache.

Epic open-ticket counts (for `--epics`) are cached separately with a **5-minute TTL**, since open work can change. `--no-cache` bypasses the epic cache too.

## Workday setup

`--workday` fetches vacation events from a [Workday RaaS](https://community.workday.com/articles/workday-report-as-a-service) (Report as a Service) report and uses them to compute the capacity ratio automatically — replacing the manual `--headcount D,F` flag.

**How it works:**

1. Two fetches run in parallel: one covering the Jira data period, one covering the forecast window.
2. For each period, `mcf` computes the average number of available team members per working day (vacationing workers subtracted per day, weekends excluded when `--exclude-weekends` is set).
3. The ratio `avg_available(forecast) / avg_available(data)` is used to scale throughput — same math as `--headcount`, but computed from real vacation data.

**1. Configure the Workday RaaS report**

Export your Workday RaaS report in JSON format. The report must include worker name, vacation start date, and vacation end date columns — the field names vary by org and are configured below.

**2. Add credentials to `~/.config/mcf/env`**

Not sure what your report's field names are? Run `mcf --show-workday-raw --from YYYY-MM-DD --to YYYY-MM-DD` (needs only `WD_JSON_LINK`, `WD_USER`, `WD_PASSWORD`, `WD_PARAM_DATE_FROM`, `WD_PARAM_DATE_TO` set) to print the raw JSON and see the actual column names before setting `WD_FIELD_*` below.

```bash
# Base URL of your Workday RaaS report — include any org-specific filter params,
# but NOT the date range params or &format=json (mcf appends those automatically).
WD_JSON_LINK=https://services1.wd502.myworkday.com/ccx/service/customreport2/yourcompany/ISU/VacationReport?Filter=value&...
WD_USER=your-integration-user
WD_PASSWORD=your-password

# Field names in the JSON response — match your report's column labels exactly.
WD_FIELD_ENTRIES=Report_Entry
WD_FIELD_WORKER=Worker
WD_FIELD_DATE_FROM=From
WD_FIELD_DATE_TO=To

# URL query parameter names used to filter by date range.
WD_PARAM_DATE_FROM=Event_Effective_Date_On_or_After
WD_PARAM_DATE_TO=Event_Effective_Date_On_or_Before

# Exclude non-engineers (people in the WD report who aren't on the dev team)
WD_EXCLUDE_WORKERS=Alice Smith,Bob Jones
```

**`--team-size` and team changes**

`--team-size N` is the headcount at the **start of the data period** (not the current team size). `mcf` uses this to compute how many people were available each day.

If the team changed mid-period, use `--leaver` and `--joiner`:

```bash
# Team was 7, lost one on 2026-06-03, will lose another on 2026-07-08
mcf --how-many --days 65 --project PROJ \
    --workday --team-size 7 \
    --leaver 2026-06-03 --leaver 2026-07-08
```

Both flags are repeatable. `mcf` applies them day-by-day to produce a weighted average for each period.

**Caching**

- Past vacation data (report end < today): **cached permanently** (rarely changes after the fact)
- Future/in-progress windows: **cached for the current day only** (refreshed next calendar day)
- `--no-cache` clears both caches for the current query

## Examples

```bash
# How many items in a 2-week sprint? (manual throughput)
mcf --how-many --days 10 --throughput 3,5,2,4,6

# Probability of finishing 30+ items in 10 days?
mcf --how-many --days 10 --throughput 3,5,2,4,6 --tickets 30

# When will a 60-ticket backlog finish?
mcf --when --tickets 60 --throughput 3,5,2,4,6

# Fetch throughput from Jira and forecast
mcf --how-many --days 10 --project PROJ --from 2026-05-01 --to 2026-06-19

# Same, excluding weekends from samples
mcf --how-many --days 10 --project PROJ --from 2026-05-01 --to 2026-06-19 --exclude-weekends

# Print the JQL that will be used before fetching
mcf --how-many --days 10 --project PROJ --from 2026-05-01 --to 2026-06-19 --show-jql

# Scale throughput: team was 4, now 6
mcf --when --tickets 60 --throughput 3,5,2,4,6 --headcount 4,6

# JSON output for scripting
mcf --how-many --days 10 --throughput 3,5,2,4,6 --json

# Forecast when three epics will finish in sequence (throughput from Jira)
mcf --when --epics PROJ-1,PROJ-2,PROJ-3 --project PROJ --from 2026-03-01 --to 2026-06-20

# Same, excluding some issue types from epic child counts
mcf --when --epics PROJ-1,PROJ-2 --project PROJ --from 2026-03-01 --to 2026-06-20 \
    --exclude-epic-types Spike,Task

# Auto-compute capacity ratio from Workday vacation data
mcf --how-many --days 65 --project PROJ \
    --workday --team-size 7

# Same, with team member changes mid-period
mcf --how-many --days 65 --project PROJ \
    --workday --team-size 7 --leaver 2026-06-03 --leaver 2026-07-08

# Forecast starting next Monday instead of today
mcf --how-many --days 10 --throughput 3,5,2,4,6 --forecast-from 2026-06-30
```

## Sample output

```
Monte Carlo forecast — How many (items in N days)
Runs: 10,000
Throughput: fetched from Jira (PROJ, 2026-05-01 – 2026-06-19, 55 tickets across 50 days)
Capacity ratio: 0.923 (8.4→7.8 avg available)

Percentiles:
  P50: 55 items   (50% confidence)
  P70: 52 items   (70% confidence)
  P85: 48 items   (85% confidence)
  P95: 44 items   (95% confidence)

Mean: 55.0 items   Min: 30   Max: 79
```

Verdicts: **On Track** (≥ 85%), **At Risk** (≥ 60%), **Unlikely** (< 60%).

**Epic forecasting output:**

```
Monte Carlo forecast — When (sequential epics)
Runs: 10,000
Throughput: fetched from Jira (PROJ, 2026-03-01 – 2026-06-20, 72 tickets across 82 days)

=== Global (all epics combined) ===
  P50: 45 days  →  2026-08-25   (50% confidence)
  P70: 51 days  →  2026-09-02   (70% confidence)
  P85: 58 days  →  2026-09-11   (85% confidence)
  P95: 67 days  →  2026-09-24   (95% confidence)

=== PROJ-1 (12 open tickets) ===
  P50: 14 days   cumulative: 2026-07-11   (50% confidence)
  P70: 16 days   cumulative: 2026-07-15   (70% confidence)
  P85: 18 days   cumulative: 2026-07-17   (85% confidence)
  P95: 22 days   cumulative: 2026-07-23   (95% confidence)

=== PROJ-2 (31 open tickets) ===
  P50: 31 days   cumulative: 2026-08-25   (50% confidence)
  P70: 35 days   cumulative: 2026-09-02   (70% confidence)
  P85: 40 days   cumulative: 2026-09-11   (85% confidence)
  P95: 45 days   cumulative: 2026-09-24   (95% confidence)
```

## Interpreting results

> ⚠️ **P95 is optimistic on the tail.** The simulation samples each day's
> throughput independently, so it can't reproduce *streaks* of bad days
> (holidays, incidents, a key dev away for two weeks) that cluster in real
> life. Reality occasionally strings those together; the model almost never
> does. Trust **P50/P70** for typical outcomes, but treat **P95** as a floor
> on the bad case, not the worst case — pad it when a slip is expensive.
>
> A future **block bootstrap** option (sampling consecutive chunks of days,
> e.g. whole weeks, instead of single days) would preserve this clustering
> and widen the tail accordingly.

## Simulation logic

Lives in [`src/lib`](src/lib) — sampling and percentile math. Keep all
simulation logic there; don't inline it into the CLI layer.

## Tests

```bash
bun test      # runs the full suite
```
