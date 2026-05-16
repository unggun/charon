# Trench Features: Fee Density, Early-Stage Block, Trench Score

**Date:** 2026-05-16
**Status:** Approved for implementation planning
**Scope:** Three additive features to Charon's strategy gating system

## Motivation

Comparing Charon's stock `defaultStrategy` against another bot's tuned strategy revealed three high-ROI gates Charon lacks: a fee-density measure, stage-banded gate values (early vs. main), and a composite "trench score" that summarizes multiple weak signals into a single tunable threshold. This spec adds these three features without touching existing gate behavior.

The trenching skill (`/root/.claude/skills/trenching/SKILL.md`) ranks the relevant priors:
- Source overlap is the cheapest edge.
- Distribution (top-20%, bundler rate) predicts outcomes better than chart patterns.
- ATH distance and stage-specific risk profile matter more than absolute mcap.

Trench Score encodes that ranking into a single number.

## Non-Goals

- **Pump Score.** Requires bonding-curve progress, time-to-bond, and per-block sniper density. Stock Charon's signal payload (`src/signals/serverClient.js`) does not include these. Defer to a separate project with its own data plumbing.
- **Synth / Bot / Sniper / Rat percentages.** Require wallet classification — an external service or local heuristic engine. Out of scope.
- **KOL count.** Requires a curated KOL wallet list and per-token overlap check. Out of scope.
- **Backwards-incompatible schema changes.** All new fields default to `0` / `null` / off → zero behavior change for existing strategies and dry-run baselines.

## Architecture

```
candidate signal
      │
      ▼
serverClient.js  ── existing source/age/fee_claim gates ──┐
      │                                                    │
      ▼                                                    │
candidateBuilder.js                                        │
  ├─ pickStageGate(strat, candidate, field)  ◄─ new helper │
  ├─ feeDensity check  ◄─ new gate                         │
  ├─ stage-banded gate evaluations  ◄─ touches existing    │
  ├─ computeTrenchScore(candidate)  ◄─ new module          │
  └─ min_trench_score check  ◄─ new gate                   │
      │                                                    │
      ▼                                                    ▼
   build LLM candidate  ──── score + breakdown surfaced ─►/candidate, /filters
```

### Module boundaries

- **`src/scoring/trenchScore.js`** (new). Pure function `computeTrenchScore(candidate) → { total, components }`. No I/O, no DB. Unit-tested in isolation.
- **`src/pipeline/stageGate.js`** (new). Pure helper `pickStageGate(strat, candidate, field) → value` and `classifyStage(strat, candidate) → 'early' | 'main'`. Unit-tested.
- **`src/pipeline/candidateBuilder.js`** (modified). Calls helpers, adds new gate evaluations. No new responsibilities — just delegates to the new modules.
- **`src/db/settings.js`** (modified). Adds new fields to `defaultStrategy()` with safe defaults.
- **`src/db/connection.js`** (modified). Adds new fields to seeded strategy presets (sniper, dip_buy, smart_money, degen).
- **`src/telegram/menus.js`** + **`src/telegram/callbacks.js`** + **`src/telegram/commands.js`** (modified). Add menu entries and `/stratset` field allowlist updates.

## Feature 1: Fee Density

### Definition

```
fee_density_sol_per_hour = fee_claim_sol / max(token_age_hours, 0.1)
```

The `max(_, 0.1)` floor avoids division blow-up on very young tokens (a 30-second-old token with 0.1 SOL claimed yields a density of 12 SOL/hr, which is correct — but capping the denominator keeps the formula well-defined).

### Schema

| Field | Type | Default | Range |
|---|---|---|---|
| `min_fee_density_sol_per_hour` | number | `0` (off) | 0–10 |

### Gate

In `candidateBuilder.js`, after existing `fee_claim_sol` checks:

```js
if (strat.min_fee_density_sol_per_hour > 0) {
  const ageHours = Math.max(tokenAgeMs / 3600000, 0.1);
  const density = (feeClaimSol || 0) / ageHours;
  if (density < strat.min_fee_density_sol_per_hour) {
    failures.push(`fee density: ${density.toFixed(2)} < ${strat.min_fee_density_sol_per_hour}`);
  }
}
```

### UI

Menu entry in the strategy config grid:
- Label: `Fee Density {value}` or `Fee Density off` when `0`.
- Stratinput key: `stratinput:min_fee_density_sol_per_hour`.

## Feature 2: Early-Stage Gate Block

### Stage classification

```js
function classifyStage(strat, candidate) {
  const threshold = strat.early_stage_mcap_threshold_usd || 30000;
  return (candidate.mcapUsd || 0) < threshold ? 'early' : 'main';
}
```

### Schema

New threshold field:

| Field | Type | Default |
|---|---|---|
| `early_stage_mcap_threshold_usd` | number | `30000` |

Dual-banded fields (each gets a sibling `early_*` field, defaulting to `null` = "fall back to main"):

| Main field | Early field | Default (early) |
|---|---|---|
| `llm_min_confidence` | `early_llm_min_confidence` | `null` |
| `min_fee_claim_sol` | `early_min_fee_claim_sol` | `null` |
| `min_gmgn_total_fee_sol` | `early_min_gmgn_total_fee_sol` | `null` |
| `max_ath_distance_pct` | `early_max_ath_distance_pct` | `null` |
| `min_holders` | `early_min_holders` | `null` |
| `max_top20_holder_percent` | `early_max_top20_holder_percent` | `null` |

### Resolver

```js
function pickStageGate(strat, candidate, field) {
  const stage = classifyStage(strat, candidate);
  if (stage === 'early') {
    const earlyKey = `early_${field}`;
    if (strat[earlyKey] !== null && strat[earlyKey] !== undefined) {
      return strat[earlyKey];
    }
  }
  return strat[field];
}
```

### Wiring

Replace direct `strat.foo` reads in `candidateBuilder.js` filter logic with `pickStageGate(strat, candidate, 'foo')` for the six dual-banded fields. Other fields read directly.

### Default behavior

All `early_*` fields default to `null` → `pickStageGate` falls through to the main field → **zero behavior change** on every existing strategy preset until the user explicitly sets an early value.

### UI

New submenu page "Early stage" accessible from the main strategy menu. Same grid layout as the main page but rendering only the six dual-banded fields plus the threshold.

## Feature 3: Trench Score

### Score components (0–100 total)

| Component | Weight | Formula |
|---|---|---|
| Source overlap | 25 | `min(sources, 3) * (25/3)` → 0 / 8.3 / 16.7 / 25 |
| Distribution | 25 | `max(0, (100 - top20_pct) / 100) * 25` |
| Bundler | 15 | `max(0, (1 - bundler_rate)) * 15` |
| Fee claim | 15 | `min(log1p(fee_claim_sol) / log1p(5), 1) * 15` |
| Holders | 10 | `min(log1p(holders) / log1p(500), 1) * 10` |
| ATH pullback | 10 | `min(abs(ath_distance_pct) / 30, 1) * 10` |

Missing values contribute `0` for that component.

### Module

`src/scoring/trenchScore.js`:

```js
export function computeTrenchScore(candidate) {
  const components = {
    sources:      sourcesScore(candidate),
    distribution: distributionScore(candidate),
    bundler:      bundlerScore(candidate),
    feeClaim:     feeClaimScore(candidate),
    holders:      holdersScore(candidate),
    athPullback:  athPullbackScore(candidate),
  };
  const total = Math.max(0, Math.min(100,
    components.sources + components.distribution + components.bundler +
    components.feeClaim + components.holders + components.athPullback
  ));
  return { total, components };
}
```

Each `*Score(candidate)` helper is private to the module and unit-tested.

### Schema

| Field | Type | Default |
|---|---|---|
| `min_trench_score` | number | `0` (off) |

### Gate

In `candidateBuilder.js`, after all individual gates pass:

```js
if (strat.min_trench_score > 0) {
  const { total, components } = computeTrenchScore(candidate);
  candidate.trenchScore = { total, components };
  if (total < strat.min_trench_score) {
    failures.push(`trench score: ${total.toFixed(1)} < ${strat.min_trench_score}`);
  }
}
```

### Surface

- `/candidate <mint>`: print full score + component breakdown.
- `/filters`: include trench-score rejections in the filter-reason summary.
- Menu: `Trench Score {value}` / `Trench Score off`.

## Data flow

```
signal payload  ──► sources, mcap, holders, fee_claim_sol, bundler_rate, top20_pct, ath_distance_pct
                        │
                        ▼
              candidateBuilder.js
                        │
        ┌───────────────┼────────────────┬─────────────────┐
        ▼               ▼                ▼                 ▼
   pickStageGate   feeDensity      computeTrenchScore   existing gates
        │               │                │                 │
        └───────────────┴────────────────┴─────────────────┘
                        │
                        ▼
                 BUY / SKIP / WAIT
```

## Error handling

- Missing fields on a candidate (e.g., `bundler_rate` unset): each scoring helper returns `0` for its component. No throw.
- Schema field missing from an existing strategy row: `strategySetting()` already supports fallbacks; the resolver treats `undefined` as "off".
- Division-by-zero in fee density: floored denominator (`max(_, 0.1)`).

## Testing

### Unit tests

- `tests/scoring/trenchScore.test.js`:
  - Each component scores 0 on missing data.
  - Each component scores at its max with maximal inputs.
  - Total clamps to [0, 100].
  - Known fixtures from the trenching skill's "Decision Examples" produce sensible scores (Example A scores low, Example C scores high).

- `tests/pipeline/stageGate.test.js`:
  - `classifyStage` returns `early` below threshold, `main` above.
  - `pickStageGate` falls through to main when early field is `null`.
  - `pickStageGate` honors early value when set.

### Integration tests

- `tests/pipeline/candidateBuilder.test.js` additions:
  - Fee-density gate accepts/rejects fixture candidates appropriately.
  - Trench-score gate accepts/rejects fixture candidates appropriately.
  - Early-stage gate uses early fields for `mcap < threshold` candidates.

### Dry-run verification

After implementation, run a dry-run window with default-off settings → verify zero behavior change against [[project_dryrun_baseline_2026_05]] (66 closed trades, recorded edge characteristics).

## Migration

All new fields are additive with safe defaults. No data migration required. Existing strategy rows in SQLite will have `undefined` for new fields → falls through to default-off behavior via existing `strategySetting()` fallback path.

## Out-of-band concerns

- **Database backfill of existing strategy rows:** Not needed. `strategySetting()` already supports fallbacks; no SQL migration script required.
- **`/stratset` field allowlist:** Add new field names to the `numKeys` set in `src/telegram/commands.js:63`.
- **Menu grid expansion:** The current strategy menu in `src/telegram/menus.js` may need pagination if too many fields render. Verify visual fit before shipping.

## Open questions

None. Defaults are conservative (all off); user can tune via `/stratset` and `/menu` after merge.

## References

- Existing strategy schema: `src/db/settings.js:77`
- Filter logic: `src/pipeline/candidateBuilder.js`
- Source-count gate: `src/signals/serverClient.js:106`
- Trenching skill: `/root/.claude/skills/trenching/SKILL.md`
- Dry-run baseline to preserve: [[project_dryrun_baseline_2026_05]]
