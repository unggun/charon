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
      tokenAgeMs: 60 * 60 * 1000,
    },
    holders: { maxHolderPercent: 20 },
    savedWalletExposure: { holderCount: 0 },
    feeClaim: { distributedSol: 1.5 },
    trending: null,
    chart: {},
    signals: { sourceCount: 2 },
    gmgn: null,
    graduation: null,
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
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
});
