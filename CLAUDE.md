# Repo

Single Bun package (`mc-forecaster`). No workspace, no build step — Bun
executes the TypeScript directly.

## Setup

```bash
bun install
bun link      # links the `mcf` binary globally (bin → src/cli.ts)
```

## Tests

```bash
bun test      # runs the full suite from the repo root
```

## Layout

- `src/cli.ts` — entry point (`mcf` binary).
- `src/lib/` — simulation core (sampling, percentiles). Keep all simulation
  logic here; don't inline it into the CLI layer.
- `src/args.ts` — CLI flag parsing. `src/jira.ts` — Jira throughput fetch.
- `src/run.ts` — wires config → simulation → result. `src/format.ts` — output.

## Relinking after changes

Bun runs source directly, so edits take effect without rebuilding. Re-run
`bun link` only if the binary path or package name changes.

## Adding dependencies

```bash
bun add some-dep
```
