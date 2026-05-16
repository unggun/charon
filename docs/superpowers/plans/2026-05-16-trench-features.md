# Trench Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three additive strategy gates to Charon — fee density, stage-banded early/main gate values, and a 0–100 composite trench score — preserving existing dry-run baseline behavior.

**Architecture:** Two new pure modules (`src/scoring/trenchScore.js`, `src/pipeline/stageGate.js`) compute scores and resolve stage-banded fields. `src/pipeline/candidateBuilder.js` gets three new gate evaluations that call into them. Schema additions in `src/db/settings.js` and `src/db/connection.js` default to `0` / `null` / off so existing strategies are unchanged.

**Tech Stack:** Node.js 18+ (ESM, built-in `node:test` module), better-sqlite3, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-16-trench-features-design.md`

---

## File Structure

| File | Responsibility | New / Modified |
|---|---|---|
| `src/scoring/trenchScore.js` | Pure: compute 0–100 composite score + component breakdown | New |
| `src/pipeline/stageGate.js` | Pure: classify candidate stage + resolve early/main field | New |
| `src/pipeline/candidateBuilder.js` | Wire new gates into `filterCandidate`; thread `ageMs`/`sourceCount` into candidate | Modified |
| `src/signals/serverClient.js` | Pass `ageMs` and `sourceCount` into `buildCandidate` | Modified |
| `src/db/settings.js` | Add new fields to `defaultStrategy()` | Modified |
| `src/db/connection.js` | Add new fields to seeded presets (sniper/dip_buy/smart_money/degen) | Modified |
| `src/telegram/commands.js` | Add new field names to `/stratset` `numKeys` allowlist | Modified |
| `src/telegram/menus.js` | Add menu rows for new gates + early-stage submenu | Modified |
| `tests/scoring/trenchScore.test.js` | Unit tests for scoring module | New |
| `tests/pipeline/stageGate.test.js` | Unit tests for stage gate helper | New |
| `package.json` | Add `test` script | Modified |

---

## Task 0: Add `test` script and create test directory

**Files:**
- Modify: `package.json`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Add test script to package.json**

Open `package.json` and update the `scripts` block to:

```json
"scripts": {
  "start": "node index.js",
  "check": "node --check index.js && node --check src/app.js && node --check src/config.js && node --check src/liveExecutor.js",
  "test": "node --test tests/**/*.test.js"
}
```

- [ ] **Step 2: Create tests directory**

```bash
mkdir -p /opt/charon/tests/scoring /opt/charon/tests/pipeline
touch /opt/charon/tests/.gitkeep
```

- [ ] **Step 3: Verify test runner works**

```bash
cd /opt/charon && npm test
```

Expected: exits cleanly with `# tests 0 # pass 0` (no test files yet, glob expands to nothing matched — that's acceptable). If you get an "ENOENT" error from glob expansion, that's a known shell quirk; the script still works once tests exist.

- [ ] **Step 4: Commit**

```bash
git add package.json tests/.gitkeep
git commit -m "Add node:test runner and tests directory"
```

---

## Task 1: Thread `ageMs` and `sourceCount` through `buildCandidate`

**Why:** Fee density and trench score both need token age and source count, which currently live only in the signal payload (`serverClient.js`) and never make it to `candidate`.

**Files:**
- Modify: `src/signals/serverClient.js:28-31` (the `triggerCandidate` wrapper)
- Modify: `src/signals/serverClient.js:148,167` (call sites)
- Modify: `src/pipeline/candidateBuilder.js:118-191` (`buildCandidate` signature and body)

- [ ] **Step 1: Update `triggerCandidate` signature in `serverClient.js`**

Replace lines 28-31:

```js
async function triggerCandidate({ mint, fee, signature, graduatedCoin, trendingToken, route, ageMs, sourceCount }) {
  if (!candidateHandler) return;
  await candidateHandler({ mint, fee, signature, graduatedCoin, trendingToken, route, ageMs, sourceCount });
}
```

- [ ] **Step 2: Pass `ageMs` and `sourceCount` at both call sites**

In `serverClient.js`, the two existing `triggerCandidate({ ... })` calls (around lines 148 and 167) need `ageMs: signal.ageMs ?? null, sourceCount: signal.sourceCount ?? 1` added to their argument objects.

Edit each call site so it reads (for example):

```js
await triggerCandidate({ mint, fee, signature, graduatedCoin, trendingToken, route, ageMs: signal.ageMs ?? null, sourceCount: signal.sourceCount ?? 1 });
```

- [ ] **Step 3: Update `buildCandidate` in `candidateBuilder.js`**

Change the function signature at line 118 from:

```js
export async function buildCandidate({ mint, fee = null, signature = null, graduatedCoin = null, trendingToken = null, route }) {
```

to:

```js
export async function buildCandidate({ mint, fee = null, signature = null, graduatedCoin = null, trendingToken = null, route, ageMs = null, sourceCount = null }) {
```

- [ ] **Step 4: Persist `ageMs` and `sourceCount` on `candidate.metrics` and `candidate.signals`**

In the `metrics` block (lines 151-164), add:

```js
tokenAgeMs: ageMs ?? null,
```

In the `signals` block (lines 165-177), add:

```js
sourceCount: sourceCount ?? (
  (Boolean(fee) ? 1 : 0) + (Boolean(graduatedCoin) ? 1 : 0) + (Boolean(trendingToken) ? 1 : 0)
),
```

The fallback computes from booleans when caller doesn't pass an explicit count.

- [ ] **Step 5: Update the candidate handler in `src/app.js` if it exists**

Check whether `src/app.js` (or wherever `setCandidateHandler` is called) destructures the arg object. If it does, ensure `ageMs` and `sourceCount` flow through to `buildCandidate`. If it just forwards `...args` or uses the object as-is, no change is needed.

```bash
grep -n "setCandidateHandler\|buildCandidate" /opt/charon/src/app.js
```

If a wrapper destructures, expand the destructure to include `ageMs` and `sourceCount` and pass them through.

- [ ] **Step 6: Syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success (exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/signals/serverClient.js src/pipeline/candidateBuilder.js src/app.js
git commit -m "Thread tokenAgeMs and sourceCount onto candidate metrics/signals"
```

---

## Task 2: Add new schema fields with off defaults

**Files:**
- Modify: `src/db/settings.js:77-91` (`defaultStrategy()`)
- Modify: `src/db/connection.js:251-377` (four `stratInsert.run(...)` calls)

- [ ] **Step 1: Extend `defaultStrategy()` in `src/db/settings.js`**

Append these fields to the returned object (before the closing `};` at line 90):

```js
    // Fee density gate
    min_fee_density_sol_per_hour: 0,
    // Early-stage block
    early_stage_mcap_threshold_usd: 30000,
    early_llm_min_confidence: null,
    early_min_fee_claim_sol: null,
    early_min_gmgn_total_fee_sol: null,
    early_max_ath_distance_pct: null,
    early_min_holders: null,
    early_max_top20_holder_percent: null,
    // Trench score gate
    min_trench_score: 0,
```

- [ ] **Step 2: Extend all four seeded presets in `src/db/connection.js`**

For each of the four `stratInsert.run(...)` calls (sniper at line 251, dip_buy at line 283, smart_money at line 315, degen at line 347), add the same 9 fields to the JSON config object, all with the same defaults as `defaultStrategy()`:

```js
    min_fee_density_sol_per_hour: 0,
    early_stage_mcap_threshold_usd: 30000,
    early_llm_min_confidence: null,
    early_min_fee_claim_sol: null,
    early_min_gmgn_total_fee_sol: null,
    early_max_ath_distance_pct: null,
    early_min_holders: null,
    early_max_top20_holder_percent: null,
    min_trench_score: 0,
```

Place them at the end of each config object, before the closing `}), ts);`.

- [ ] **Step 3: Syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success.

- [ ] **Step 4: Commit**

```bash
git add src/db/settings.js src/db/connection.js
git commit -m "Add schema fields for fee density, early-stage block, trench score (all off by default)"
```

---

## Task 3: Implement `pickStageGate` helper

**Files:**
- Create: `src/pipeline/stageGate.js`
- Create: `tests/pipeline/stageGate.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/pipeline/stageGate.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStage, pickStageGate } from '../../src/pipeline/stageGate.js';

test('classifyStage returns early when mcap < threshold', () => {
  const strat = { early_stage_mcap_threshold_usd: 30000 };
  const candidate = { metrics: { marketCapUsd: 15000 } };
  assert.equal(classifyStage(strat, candidate), 'early');
});

test('classifyStage returns main when mcap >= threshold', () => {
  const strat = { early_stage_mcap_threshold_usd: 30000 };
  const candidate = { metrics: { marketCapUsd: 50000 } };
  assert.equal(classifyStage(strat, candidate), 'main');
});

test('classifyStage falls back to 30000 when threshold missing', () => {
  const strat = {};
  const candidate = { metrics: { marketCapUsd: 25000 } };
  assert.equal(classifyStage(strat, candidate), 'early');
});

test('classifyStage treats missing mcap as 0 → early', () => {
  const strat = { early_stage_mcap_threshold_usd: 30000 };
  const candidate = { metrics: {} };
  assert.equal(classifyStage(strat, candidate), 'early');
});

test('pickStageGate returns early value when set and stage is early', () => {
  const strat = {
    early_stage_mcap_threshold_usd: 30000,
    llm_min_confidence: 50,
    early_llm_min_confidence: 75,
  };
  const candidate = { metrics: { marketCapUsd: 10000 } };
  assert.equal(pickStageGate(strat, candidate, 'llm_min_confidence'), 75);
});

test('pickStageGate falls back to main when early value is null', () => {
  const strat = {
    early_stage_mcap_threshold_usd: 30000,
    llm_min_confidence: 50,
    early_llm_min_confidence: null,
  };
  const candidate = { metrics: { marketCapUsd: 10000 } };
  assert.equal(pickStageGate(strat, candidate, 'llm_min_confidence'), 50);
});

test('pickStageGate falls back to main when early value is undefined', () => {
  const strat = {
    early_stage_mcap_threshold_usd: 30000,
    llm_min_confidence: 50,
  };
  const candidate = { metrics: { marketCapUsd: 10000 } };
  assert.equal(pickStageGate(strat, candidate, 'llm_min_confidence'), 50);
});

test('pickStageGate always uses main when stage is main', () => {
  const strat = {
    early_stage_mcap_threshold_usd: 30000,
    llm_min_confidence: 50,
    early_llm_min_confidence: 75,
  };
  const candidate = { metrics: { marketCapUsd: 50000 } };
  assert.equal(pickStageGate(strat, candidate, 'llm_min_confidence'), 50);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/charon && npm test
```

Expected: FAIL with `Cannot find module 'src/pipeline/stageGate.js'`.

- [ ] **Step 3: Create the module**

Create `src/pipeline/stageGate.js`:

```js
export function classifyStage(strat, candidate) {
  const threshold = strat?.early_stage_mcap_threshold_usd ?? 30000;
  const mcap = candidate?.metrics?.marketCapUsd ?? 0;
  return mcap < threshold ? 'early' : 'main';
}

export function pickStageGate(strat, candidate, field) {
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /opt/charon && npm test
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/stageGate.js tests/pipeline/stageGate.test.js
git commit -m "Add stageGate helper (classifyStage + pickStageGate)"
```

---

## Task 4: Wire fee density gate

**Files:**
- Modify: `src/pipeline/candidateBuilder.js` (`filterCandidate`, after the existing fee-claim block)

- [ ] **Step 1: Add the fee density gate in `filterCandidate`**

In `src/pipeline/candidateBuilder.js`, locate the fee-claim block (lines 45-53). Immediately after it, insert:

```js
  // Fee density (SOL/hr) — only enforce when both fee_claim and tokenAgeMs are available
  if (strat.min_fee_density_sol_per_hour > 0 && candidate.feeClaim) {
    const tokenAgeMs = candidate.metrics.tokenAgeMs;
    if (Number.isFinite(tokenAgeMs) && tokenAgeMs > 0) {
      const ageHours = Math.max(tokenAgeMs / 3600000, 0.1);
      const density = (feeSol || 0) / ageHours;
      if (density < strat.min_fee_density_sol_per_hour) {
        failures.push(`fee density: ${density.toFixed(2)} SOL/hr < ${strat.min_fee_density_sol_per_hour}`);
      }
    }
  }
```

- [ ] **Step 2: Syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success.

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/candidateBuilder.js
git commit -m "Add fee density gate to filterCandidate"
```

---

## Task 5: Wire stage-banded fields in `filterCandidate`

**Files:**
- Modify: `src/pipeline/candidateBuilder.js` (six existing gate evaluations)

- [ ] **Step 1: Import `pickStageGate`**

At the top of `src/pipeline/candidateBuilder.js`, after the existing imports, add:

```js
import { pickStageGate } from './stageGate.js';
```

- [ ] **Step 2: Replace six direct `strat.X` reads with `pickStageGate(strat, candidate, 'X')`**

In `filterCandidate`, replace these reads:

| Old (line approx) | New |
|---|---|
| `strat.min_fee_claim_sol ?? 0.5` (line 47) | `(pickStageGate(strat, candidate, 'min_fee_claim_sol') ?? 0.5)` |
| `strat.min_gmgn_total_fee_sol` (line 64) | `pickStageGate(strat, candidate, 'min_gmgn_total_fee_sol')` |
| `strat.min_holders` (line 74) | `pickStageGate(strat, candidate, 'min_holders')` |
| `strat.max_top20_holder_percent` (line 79) | `pickStageGate(strat, candidate, 'max_top20_holder_percent')` |
| `strat.max_ath_distance_pct` (lines 89, 91) | `pickStageGate(strat, candidate, 'max_ath_distance_pct')` |

Use a local const where the value is referenced twice in a row. Example for the ATH block:

```js
  // ATH distance (dip buy strategy)
  const maxAthDist = pickStageGate(strat, candidate, 'max_ath_distance_pct');
  if (maxAthDist < 0) {
    const athDist = candidate.chart?.distanceFromAthPercent;
    if (athDist != null && athDist > maxAthDist) {
      failures.push(`ATH distance: ${athDist.toFixed(0)}% > target ${maxAthDist}%`);
    }
  }
```

Note: `llm_min_confidence` is not gated in `filterCandidate` (it's read elsewhere in the LLM path). Skip it here; the LLM call-site change is Task 8.

- [ ] **Step 3: Syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/candidateBuilder.js
git commit -m "Use pickStageGate for early-banded fields in filterCandidate"
```

---

## Task 6: Implement `computeTrenchScore` module

**Files:**
- Create: `src/scoring/trenchScore.js`
- Create: `tests/scoring/trenchScore.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/scoring/trenchScore.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTrenchScore } from '../../src/scoring/trenchScore.js';

const emptyCandidate = {
  signals: { sourceCount: 0 },
  holders: { maxHolderPercent: 100 },
  trending: null,
  feeClaim: null,
  metrics: { holderCount: 0 },
  chart: {},
};

test('all-zero candidate scores 0', () => {
  const { total, components } = computeTrenchScore(emptyCandidate);
  assert.equal(total, 0);
  assert.equal(components.sources, 0);
  assert.equal(components.distribution, 0);
  assert.equal(components.bundler, 0);
  assert.equal(components.feeClaim, 0);
  assert.equal(components.holders, 0);
  assert.equal(components.athPullback, 0);
});

test('maximal candidate scores ~100', () => {
  const maximal = {
    signals: { sourceCount: 3 },
    holders: { maxHolderPercent: 0 },
    trending: { bundler_rate: 0 },
    feeClaim: { distributedSol: 10 },
    metrics: { holderCount: 2000 },
    chart: { distanceFromAthPercent: -50 },
  };
  const { total } = computeTrenchScore(maximal);
  assert.ok(total >= 99 && total <= 100, `expected ~100, got ${total}`);
});

test('total clamps to [0, 100]', () => {
  const exaggerated = {
    signals: { sourceCount: 99 },
    holders: { maxHolderPercent: -10 },
    trending: { bundler_rate: -1 },
    feeClaim: { distributedSol: 1000 },
    metrics: { holderCount: 1e6 },
    chart: { distanceFromAthPercent: -999 },
  };
  const { total } = computeTrenchScore(exaggerated);
  assert.ok(total >= 0 && total <= 100);
});

test('source component caps at 3 sources', () => {
  const c2 = { ...emptyCandidate, signals: { sourceCount: 2 } };
  const c3 = { ...emptyCandidate, signals: { sourceCount: 3 } };
  const c5 = { ...emptyCandidate, signals: { sourceCount: 5 } };
  assert.equal(computeTrenchScore(c3).components.sources, computeTrenchScore(c5).components.sources);
  assert.ok(computeTrenchScore(c3).components.sources > computeTrenchScore(c2).components.sources);
});

test('distribution component rewards lower top-holder percent', () => {
  const concentrated = { ...emptyCandidate, holders: { maxHolderPercent: 80 } };
  const distributed = { ...emptyCandidate, holders: { maxHolderPercent: 10 } };
  assert.ok(
    computeTrenchScore(distributed).components.distribution >
    computeTrenchScore(concentrated).components.distribution
  );
});

test('skill example A (single source, fresh curve, bundled) scores low', () => {
  // From trenching skill: age 90s, mcap $14k, sources=1, top20=38%, bundle=6%, dev=5%
  const candidate = {
    signals: { sourceCount: 1 },
    holders: { maxHolderPercent: 38 },
    trending: { bundler_rate: 0.06 },
    feeClaim: { distributedSol: 0 },
    metrics: { holderCount: 30 },
    chart: { distanceFromAthPercent: 0 },
  };
  const { total } = computeTrenchScore(candidate);
  assert.ok(total < 40, `expected low score for skill Example A, got ${total}`);
});

test('skill example C (post-migration smart money) scores high', () => {
  // From trenching skill: mcap $310k, holders=1100, top20=19%, vol_1h=$480k
  const candidate = {
    signals: { sourceCount: 3 },
    holders: { maxHolderPercent: 19 },
    trending: { bundler_rate: 0.05 },
    feeClaim: { distributedSol: 3 },
    metrics: { holderCount: 1100 },
    chart: { distanceFromAthPercent: -10 },
  };
  const { total } = computeTrenchScore(candidate);
  assert.ok(total >= 60, `expected high score for skill Example C, got ${total}`);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /opt/charon && npm test
```

Expected: FAIL with `Cannot find module 'src/scoring/trenchScore.js'`.

- [ ] **Step 3: Create the module**

Create `src/scoring/trenchScore.js`:

```js
function sourcesScore(candidate) {
  const n = Number(candidate?.signals?.sourceCount ?? 0);
  const capped = Math.max(0, Math.min(n, 3));
  return capped * (25 / 3);
}

function distributionScore(candidate) {
  const top = Number(candidate?.holders?.maxHolderPercent ?? 100);
  const clamped = Math.max(0, Math.min(top, 100));
  return ((100 - clamped) / 100) * 25;
}

function bundlerScore(candidate) {
  const rate = Number(candidate?.trending?.bundler_rate ?? 1);
  const clamped = Math.max(0, Math.min(rate, 1));
  return (1 - clamped) * 15;
}

function feeClaimScore(candidate) {
  const sol = Number(candidate?.feeClaim?.distributedSol ?? 0);
  if (sol <= 0) return 0;
  const ratio = Math.log1p(sol) / Math.log1p(5);
  return Math.min(ratio, 1) * 15;
}

function holdersScore(candidate) {
  const h = Number(candidate?.metrics?.holderCount ?? 0);
  if (h <= 0) return 0;
  const ratio = Math.log1p(h) / Math.log1p(500);
  return Math.min(ratio, 1) * 10;
}

function athPullbackScore(candidate) {
  const dist = Number(candidate?.chart?.distanceFromAthPercent ?? 0);
  // Distance is signed: -30 means 30% below ATH. Reward magnitude up to 30%.
  const magnitude = Math.abs(dist);
  const ratio = Math.min(magnitude / 30, 1);
  return ratio * 10;
}

export function computeTrenchScore(candidate) {
  const components = {
    sources:      sourcesScore(candidate),
    distribution: distributionScore(candidate),
    bundler:      bundlerScore(candidate),
    feeClaim:     feeClaimScore(candidate),
    holders:      holdersScore(candidate),
    athPullback:  athPullbackScore(candidate),
  };
  const sum =
    components.sources + components.distribution + components.bundler +
    components.feeClaim + components.holders + components.athPullback;
  const total = Math.max(0, Math.min(100, sum));
  return { total, components };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /opt/charon && npm test
```

Expected: PASS (7 tests in this file, 15 total with stageGate).

- [ ] **Step 5: Commit**

```bash
git add src/scoring/trenchScore.js tests/scoring/trenchScore.test.js
git commit -m "Add trench score scoring module"
```

---

## Task 7: Wire trench score gate

**Files:**
- Modify: `src/pipeline/candidateBuilder.js` (`filterCandidate` — add score gate after existing gates)
- Modify: `src/pipeline/candidateBuilder.js` (`buildCandidate` — stash score on candidate for surfacing)

- [ ] **Step 1: Import the scorer**

At the top of `src/pipeline/candidateBuilder.js`, after the `stageGate` import added in Task 5, add:

```js
import { computeTrenchScore } from '../scoring/trenchScore.js';
```

- [ ] **Step 2: Add the trench score gate at the end of `filterCandidate`**

Just before `return { passed: failures.length === 0, failures, strategy: strat.id };` (currently line 115), insert:

```js
  // Trench score gate — composite floor across multiple signals
  if (strat.min_trench_score > 0) {
    const { total } = computeTrenchScore(candidate);
    if (total < strat.min_trench_score) {
      failures.push(`trench score: ${total.toFixed(1)} < ${strat.min_trench_score}`);
    }
  }
```

- [ ] **Step 3: Stash the score on the candidate in `buildCandidate`**

In `buildCandidate`, just before `candidate.filters = filterCandidate(candidate);` (currently line 189), add:

```js
  candidate.trenchScore = computeTrenchScore(candidate);
```

This makes the score available to `/candidate` dumps and downstream consumers regardless of whether the gate is on.

- [ ] **Step 4: Syntax check + run tests**

```bash
cd /opt/charon && npm run check && npm test
```

Expected: silent check; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/candidateBuilder.js
git commit -m "Wire trench score gate and stash score on candidate"
```

---

## Task 8: Update `/stratset` allowlist

**Files:**
- Modify: `src/telegram/commands.js:63` (`numKeys` Set)

- [ ] **Step 1: Add new numeric field names to `numKeys`**

In `src/telegram/commands.js`, find the line starting with `const numKeys = new Set([...]);` (around line 63). Add the following keys to the array (preserve existing keys):

```
'min_fee_density_sol_per_hour',
'early_stage_mcap_threshold_usd',
'early_llm_min_confidence',
'early_min_fee_claim_sol',
'early_min_gmgn_total_fee_sol',
'early_max_ath_distance_pct',
'early_min_holders',
'early_max_top20_holder_percent',
'min_trench_score',
```

- [ ] **Step 2: Update the usage-hint string**

Find the `bot.sendMessage` call earlier in the same `if (text.startsWith('/stratset'))` block (line 59) that lists valid keys. Append the new keys to the comma-separated list so users discover them.

Example: change `..., max_ath_distance_pct` at the end of the keys list to `..., max_ath_distance_pct, min_fee_density_sol_per_hour, early_stage_mcap_threshold_usd, early_llm_min_confidence, early_min_fee_claim_sol, early_min_gmgn_total_fee_sol, early_max_ath_distance_pct, early_min_holders, early_max_top20_holder_percent, min_trench_score`.

- [ ] **Step 3: Syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success.

- [ ] **Step 4: Commit**

```bash
git add src/telegram/commands.js
git commit -m "Allow new gate keys in /stratset numKeys"
```

---

## Task 9: Add menu rows for new gates

**Files:**
- Modify: `src/telegram/menus.js` (`strategyKeyboard` config block)

- [ ] **Step 1: Add a Fee Density row and a Trench Score row**

In `src/telegram/menus.js`, locate the `config` array inside `strategyKeyboard()` (around line 226). Add a new row before the final standalone-button row (the one with `Partial At`):

```js
    [
      { text: `Fee Density ${strat.min_fee_density_sol_per_hour > 0 ? strat.min_fee_density_sol_per_hour : 'off'}`, callback_data: 'stratinput:min_fee_density_sol_per_hour' },
      { text: `Trench Score ${strat.min_trench_score > 0 ? strat.min_trench_score : 'off'}`, callback_data: 'stratinput:min_trench_score' },
    ],
    [
      { text: '── Early Stage ──', callback_data: 'menu:strategy_early' },
    ],
```

- [ ] **Step 2: Add labels for the new numeric keys**

In `src/telegram/menus.js`, locate `strategyNumericLabels` (around line 68). Add:

```js
  min_fee_density_sol_per_hour: 'minimum fee density (SOL per hour)',
  min_trench_score: 'minimum trench score (0-100)',
  early_stage_mcap_threshold_usd: 'mcap threshold below which a candidate is "early" (USD)',
  early_llm_min_confidence: 'early-stage LLM minimum confidence percent (null = use main)',
  early_min_fee_claim_sol: 'early-stage minimum creator fee-claim SOL (null = use main)',
  early_min_gmgn_total_fee_sol: 'early-stage minimum total trading fees SOL (null = use main)',
  early_max_ath_distance_pct: 'early-stage maximum ATH distance percent (null = use main)',
  early_min_holders: 'early-stage minimum holders (null = use main)',
  early_max_top20_holder_percent: 'early-stage maximum top holder percent (null = use main)',
```

- [ ] **Step 3: Surface trench score in `strategyMenuText`**

In `strategyMenuText` (around line 193), add to the array of lines (before the empty string before the strategy list):

```js
    strat.min_trench_score > 0 ? `Min trench score: ${strat.min_trench_score}` : null,
    strat.min_fee_density_sol_per_hour > 0 ? `Min fee density: ${strat.min_fee_density_sol_per_hour} SOL/hr` : null,
```

- [ ] **Step 4: Syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/menus.js
git commit -m "Add menu rows and labels for new strategy gates"
```

---

## Task 10: Manual verification + dry-run baseline check

**Files:** none (verification step)

- [ ] **Step 1: Run full test suite**

```bash
cd /opt/charon && npm test
```

Expected: all tests pass (15 tests total).

- [ ] **Step 2: Run syntax check**

```bash
cd /opt/charon && npm run check
```

Expected: silent success.

- [ ] **Step 3: Inspect the DB to confirm new fields appear in existing strategies (manual)**

The new fields are only persisted on *new* strategies created after this code lands. Existing rows in the user's SQLite DB will not have them, which is fine — `pickStageGate` and the new gates treat missing/undefined as off (default behavior).

Verify by spot-checking via the Telegram `/strategy` command and `/stratset sniper min_trench_score 40`. Confirm the menu now shows `Trench Score 40` and the `/strategy` text reflects it.

- [ ] **Step 4: Confirm zero-impact on dry-run baseline**

With all new fields at default (`0` / `null` / off), `filterCandidate` adds no new failures. Run a short dry-run window (e.g., 30 min) and confirm filter-rejection reasons in `/filters` are unchanged from [[project_dryrun_baseline_2026_05]].

If you observe new rejection reasons mentioning "fee density", "trench score", or "stage", a field is unintentionally non-zero. Trace it back via `/strategy` output.

- [ ] **Step 5: Wrap-up (no commit needed)**

If everything checks out, the feature is ready for the user to tune via `/stratset` and `/menu`.

---

## Task 11: Integration tests for `filterCandidate` gates

**Why:** Spec calls for integration tests covering the three new gates' accept/reject behavior. Requires a small refactor so `filterCandidate` is testable without DB seeding.

**Files:**
- Modify: `src/pipeline/candidateBuilder.js` (`filterCandidate` signature)
- Create: `tests/pipeline/candidateBuilder.test.js`

- [ ] **Step 1: Refactor `filterCandidate` to accept `strat` as an optional second arg**

In `src/pipeline/candidateBuilder.js`, change line 30:

```js
export function filterCandidate(candidate) {
  const strat = activeStrategy();
```

to:

```js
export function filterCandidate(candidate, strat = null) {
  if (strat === null) strat = activeStrategy();
```

This preserves existing call sites (they pass no second arg, behavior unchanged) and lets tests inject a strategy.

- [ ] **Step 2: Write the failing integration tests**

Create `tests/pipeline/candidateBuilder.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCandidate } from '../../src/pipeline/candidateBuilder.js';

function baseCandidate(overrides = {}) {
  return {
    metrics: {
      marketCapUsd: 50000,
      gmgnTotalFeesSol: 100,
      graduatedVolumeUsd: 0,
      holderCount: 500,
      tokenAgeMs: 60 * 60 * 1000, // 1 hour
    },
    holders: { maxHolderPercent: 20 },
    savedWalletExposure: { holderCount: 0 },
    feeClaim: { distributedSol: 1.5 },
    trending: null,
    chart: {},
    signals: { sourceCount: 2 },
    ...overrides,
  };
}

function baseStrat(overrides = {}) {
  return {
    id: 'sniper',
    min_fee_claim_sol: 0,
    min_mcap_usd: 0,
    max_mcap_usd: 0,
    min_gmgn_total_fee_sol: 0,
    min_graduated_volume_usd: 0,
    min_holders: 0,
    max_top20_holder_percent: 100,
    min_saved_wallet_holders: 0,
    max_ath_distance_pct: 0,
    require_fee_claim: false,
    min_fee_density_sol_per_hour: 0,
    early_stage_mcap_threshold_usd: 30000,
    min_trench_score: 0,
    ...overrides,
  };
}

test('fee density gate rejects low-density candidate', () => {
  const candidate = baseCandidate({
    feeClaim: { distributedSol: 0.05 },
    metrics: { ...baseCandidate().metrics, tokenAgeMs: 60 * 60 * 1000 },
  });
  const strat = baseStrat({ min_fee_density_sol_per_hour: 0.8 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('fee density:')));
});

test('fee density gate accepts high-density candidate', () => {
  const candidate = baseCandidate({
    feeClaim: { distributedSol: 2 },
    metrics: { ...baseCandidate().metrics, tokenAgeMs: 60 * 60 * 1000 },
  });
  const strat = baseStrat({ min_fee_density_sol_per_hour: 0.8 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, true);
});

test('fee density gate does not run when fee_claim missing', () => {
  const candidate = baseCandidate({ feeClaim: null });
  const strat = baseStrat({ min_fee_density_sol_per_hour: 5 });
  const result = filterCandidate(candidate, strat);
  // No fee density failure even though density would be 0
  assert.ok(!result.failures.some(f => f.startsWith('fee density:')));
});

test('trench score gate rejects low-score candidate', () => {
  const candidate = baseCandidate({
    signals: { sourceCount: 1 },
    holders: { maxHolderPercent: 80 },
  });
  const strat = baseStrat({ min_trench_score: 50 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('trench score:')));
});

test('trench score gate accepts high-score candidate', () => {
  const candidate = baseCandidate({
    signals: { sourceCount: 3 },
    holders: { maxHolderPercent: 15 },
    metrics: { ...baseCandidate().metrics, holderCount: 1500 },
  });
  const strat = baseStrat({ min_trench_score: 40 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, true);
});

test('early-stage gate uses early_min_holders when mcap below threshold', () => {
  const candidate = baseCandidate({
    metrics: { ...baseCandidate().metrics, marketCapUsd: 10000, holderCount: 30 },
  });
  const strat = baseStrat({
    min_holders: 100,
    early_min_holders: 20,
    early_stage_mcap_threshold_usd: 30000,
  });
  // Candidate is "early" (mcap 10k < 30k); early_min_holders = 20; 30 >= 20 → pass
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, true);
});

test('early-stage gate falls back to main min_holders when above threshold', () => {
  const candidate = baseCandidate({
    metrics: { ...baseCandidate().metrics, marketCapUsd: 50000, holderCount: 30 },
  });
  const strat = baseStrat({
    min_holders: 100,
    early_min_holders: 20,
    early_stage_mcap_threshold_usd: 30000,
  });
  // Candidate is "main" (mcap 50k >= 30k); main min_holders = 100; 30 < 100 → fail
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('holders:')));
});

test('early-stage gate falls back to main when early_* is null', () => {
  const candidate = baseCandidate({
    metrics: { ...baseCandidate().metrics, marketCapUsd: 10000, holderCount: 30 },
  });
  const strat = baseStrat({
    min_holders: 100,
    early_min_holders: null,
    early_stage_mcap_threshold_usd: 30000,
  });
  // Early, but early_min_holders is null → falls back to main (100); 30 < 100 → fail
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd /opt/charon && npm test
```

Expected: PASS (all tests across all files; 23 total).

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/candidateBuilder.js tests/pipeline/candidateBuilder.test.js
git commit -m "Add integration tests for fee density, trench score, and early-stage gates"
```

---

## Out of scope (not in this plan)

- Pump Score: needs bonding-curve data not in the signal payload.
- Synth/Bot/Sniper/Rat wallet classification: needs an external labeling service.
- KOL count: needs a maintained KOL wallet list.
- Weight tuning of the trench score: ship with the spec's weights; tune empirically via `/learn` over a dry-run window once data accumulates.
