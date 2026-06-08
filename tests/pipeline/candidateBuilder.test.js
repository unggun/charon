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

test('organic score gate rejects candidate below threshold', () => {
  const candidate = baseCandidate({ jupiterAsset: { organicScore: 25 } });
  const strat = baseStrat({ min_organic_score: 40 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('organic score:')));
});

test('organic score gate accepts candidate at or above threshold', () => {
  const candidate = baseCandidate({ jupiterAsset: { organicScore: 55 } });
  const strat = baseStrat({ min_organic_score: 40 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, true);
});

test('organic score gate is skipped when jupiterAsset is missing', () => {
  const candidate = baseCandidate({ jupiterAsset: null });
  const strat = baseStrat({ min_organic_score: 80 });
  const result = filterCandidate(candidate, strat);
  assert.ok(!result.failures.some(f => f.startsWith('organic score:')));
});

test('bonding-band skip rejects candidate inside the band', () => {
  const candidate = baseCandidate({ jupiterAsset: { bondingCurve: 92 } });
  const strat = baseStrat({ skip_bonding_band_min: 80, skip_bonding_band_max: 99 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('bonding curve:')));
});

test('bonding-band skip accepts candidate outside the band', () => {
  const insideEdge = baseCandidate({ jupiterAsset: { bondingCurve: 100 } });
  const below = baseCandidate({ jupiterAsset: { bondingCurve: 50 } });
  const strat = baseStrat({ skip_bonding_band_min: 80, skip_bonding_band_max: 99 });
  assert.equal(filterCandidate(insideEdge, strat).passed, true);
  assert.equal(filterCandidate(below, strat).passed, true);
});

test('bonding-band skip stays off when only one endpoint is set', () => {
  const candidate = baseCandidate({ jupiterAsset: { bondingCurve: 50 } });
  const stratMaxOnly = baseStrat({ skip_bonding_band_max: 99 });
  assert.equal(filterCandidate(candidate, stratMaxOnly).passed, true,
    'min=0 should disable the gate so we do not skip every pre-graduated token');
  const stratMinOnly = baseStrat({ skip_bonding_band_min: 80 });
  assert.equal(filterCandidate(candidate, stratMinOnly).passed, true,
    'max=0 should disable the gate too');
});

test('jupiter bundler ATH gate rejects candidate above threshold', () => {
  const candidate = baseCandidate({
    jupiterAsset: { audit: { bundlerStats: { holdingPctATH: 7.5 } } },
  });
  const strat = baseStrat({ max_jup_bundler_ath_pct: 5 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('bundler ATH:')));
});

test('jupiter bundler ATH gate accepts candidate at or below threshold', () => {
  const inBand = baseCandidate({
    jupiterAsset: { audit: { bundlerStats: { holdingPctATH: 5 } } },
  });
  const below = baseCandidate({
    jupiterAsset: { audit: { bundlerStats: { holdingPctATH: 0.3 } } },
  });
  const strat = baseStrat({ max_jup_bundler_ath_pct: 5 });
  assert.equal(filterCandidate(inBand, strat).passed, true);
  assert.equal(filterCandidate(below, strat).passed, true);
});

test('jupiter bundler ATH gate is skipped when bundlerStats missing', () => {
  const noAudit = baseCandidate({ jupiterAsset: { id: 'x' } });
  const noStats = baseCandidate({ jupiterAsset: { audit: {} } });
  const noField = baseCandidate({ jupiterAsset: { audit: { bundlerStats: {} } } });
  const noJup = baseCandidate({ jupiterAsset: null });
  const strat = baseStrat({ max_jup_bundler_ath_pct: 5 });
  for (const c of [noAudit, noStats, noField, noJup]) {
    assert.ok(!filterCandidate(c, strat).failures.some(f => f.startsWith('bundler ATH:')));
  }
});

test('jupiter bundler ATH gate stays off when threshold is 0', () => {
  const candidate = baseCandidate({
    jupiterAsset: { audit: { bundlerStats: { holdingPctATH: 99 } } },
  });
  const strat = baseStrat({ max_jup_bundler_ath_pct: 0 });
  assert.ok(!filterCandidate(candidate, strat).failures.some(f => f.startsWith('bundler ATH:')));
});

test('top-20 aggregate gate rejects candidate above threshold', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 20, top20Percent: 68 } });
  const strat = baseStrat({ max_top20_holder_percent: 40 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('top20 holders:')));
});

test('top-20 aggregate gate accepts candidate below threshold', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 20, top20Percent: 30 } });
  const strat = baseStrat({ max_top20_holder_percent: 40 });
  assert.equal(filterCandidate(candidate, strat).passed, true);
});

test('top-20 aggregate gate is disabled at 100', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 20, top20Percent: 99 } });
  const strat = baseStrat({ max_top20_holder_percent: 100 });
  assert.ok(!filterCandidate(candidate, strat).failures.some(f => f.startsWith('top20 holders:')));
});

test('top-20 aggregate gate is skipped when top20Percent is missing', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 20 } });
  const strat = baseStrat({ max_top20_holder_percent: 40 });
  assert.ok(!filterCandidate(candidate, strat).failures.some(f => f.startsWith('top20 holders:')));
});

test('single-holder gate rejects when largest holder exceeds threshold', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 50, top20Percent: 60 } });
  const strat = baseStrat({ max_single_holder_percent: 40, max_top20_holder_percent: 100 });
  const result = filterCandidate(candidate, strat);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(f => f.startsWith('max single holder:')));
});

test('single-holder gate accepts when largest holder below threshold', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 30, top20Percent: 60 } });
  const strat = baseStrat({ max_single_holder_percent: 40, max_top20_holder_percent: 100 });
  assert.equal(filterCandidate(candidate, strat).passed, true);
});

test('single-holder gate is skipped when field is unset (legacy strategy rows)', () => {
  // baseStrat does not define max_single_holder_percent → gate must not run
  const candidate = baseCandidate({ holders: { maxHolderPercent: 90, top20Percent: 20 } });
  const strat = baseStrat({ max_top20_holder_percent: 100 });
  assert.ok(!filterCandidate(candidate, strat).failures.some(f => f.startsWith('max single holder:')));
});

test('single-holder gate is disabled at 100', () => {
  const candidate = baseCandidate({ holders: { maxHolderPercent: 99, top20Percent: 20 } });
  const strat = baseStrat({ max_single_holder_percent: 100, max_top20_holder_percent: 100 });
  assert.ok(!filterCandidate(candidate, strat).failures.some(f => f.startsWith('max single holder:')));
});
