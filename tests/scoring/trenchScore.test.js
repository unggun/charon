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
  // Score reflects: weak sources (1/3) + missing fee_claim + no ATH pullback,
  // partially offset by acceptable distribution and bundler readings.
  // At the screenshot's threshold of 40 this is a borderline skip.
  assert.ok(total < 50, `expected low score for skill Example A, got ${total}`);
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
