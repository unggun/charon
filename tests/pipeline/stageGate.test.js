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
