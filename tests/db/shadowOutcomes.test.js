import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb, db } from '../../src/db/connection.js';
import {
  SHADOW_GRACE_MIN,
  dueShadowCandidates,
  insertShadowOutcome,
  shadowOutcomesForMint,
} from '../../src/db/shadowOutcomes.js';

initDb();

const NOW = 10_000 * 60_000;
let nextId = 1;

function makeCandidate({ mint, ageMin, status = 'filtered' }) {
  const id = nextId++;
  db.prepare(`
    INSERT INTO candidates (id, mint, status, created_at_ms, updated_at_ms, signal_key, candidate_json, filter_result_json)
    VALUES (?, ?, ?, ?, ?, ?, '{}', '{}')
  `).run(id, mint, status, NOW - ageMin * 60_000, NOW, `sig-${id}`);
  return id;
}

function makeOutcome(candidateId, mint, checkpointMin, overrides = {}) {
  return {
    candidate_id: candidateId,
    mint,
    candidate_status: 'filtered',
    checkpoint_min: checkpointMin,
    at_ms: NOW,
    price_usd: 0.001,
    mcap_usd: 12000,
    liquidity_usd: 4000,
    holder_count: 200,
    ...overrides,
  };
}

test('dueShadowCandidates returns candidates inside the checkpoint window only', () => {
  const dueId = makeCandidate({ mint: 'DUE', ageMin: 31 });
  makeCandidate({ mint: 'TOO_YOUNG', ageMin: 29 });
  makeCandidate({ mint: 'TOO_OLD', ageMin: 31 + SHADOW_GRACE_MIN });

  const due = dueShadowCandidates(30, NOW, 10);
  const mints = due.map(c => c.mint);
  assert.ok(mints.includes('DUE'));
  assert.ok(!mints.includes('TOO_YOUNG'));
  assert.ok(!mints.includes('TOO_OLD'));
  assert.equal(due.find(c => c.mint === 'DUE').id, dueId);
});

test('dueShadowCandidates skips candidates already sampled for that checkpoint', () => {
  const id = makeCandidate({ mint: 'SAMPLED', ageMin: 35 });
  insertShadowOutcome(makeOutcome(id, 'SAMPLED', 30));

  const due30 = dueShadowCandidates(30, NOW, 10);
  assert.ok(!due30.map(c => c.mint).includes('SAMPLED'));
});

test('a 30m sample does not satisfy the 60m checkpoint', () => {
  const id = makeCandidate({ mint: 'NEXT_CP', ageMin: 65 });
  insertShadowOutcome(makeOutcome(id, 'NEXT_CP', 30));

  const due60 = dueShadowCandidates(60, NOW, 10);
  assert.ok(due60.map(c => c.mint).includes('NEXT_CP'));
});

test('duplicate-signal candidates for one mint yield a single due row', () => {
  makeCandidate({ mint: 'DUP', ageMin: 32 });
  makeCandidate({ mint: 'DUP', ageMin: 33 });

  const due = dueShadowCandidates(30, NOW, 10);
  assert.equal(due.filter(c => c.mint === 'DUP').length, 1);
});

test('insertShadowOutcome is idempotent per candidate/checkpoint', () => {
  const id = makeCandidate({ mint: 'IDEM', ageMin: 40 });
  insertShadowOutcome(makeOutcome(id, 'IDEM', 30));
  insertShadowOutcome(makeOutcome(id, 'IDEM', 30, { mcap_usd: 99999 }));

  const rows = shadowOutcomesForMint('IDEM');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mcap_usd, 12000);
});
