import { db } from './connection.js';

export const SHADOW_CHECKPOINTS_MIN = [30, 60, 120];
export const SHADOW_GRACE_MIN = 20;

// Candidates whose age has crossed `checkpointMin` (within the grace window)
// and that have no outcome row yet for that checkpoint. One row per mint per
// cycle — duplicate-signal candidates for the same mint share the asset fetch
// via the jupiter cache, but there is no point sampling the same mint twice.
export function dueShadowCandidates(checkpointMin, nowMs, limit = 10) {
  const newest = nowMs - checkpointMin * 60_000;
  const oldest = nowMs - (checkpointMin + SHADOW_GRACE_MIN) * 60_000;
  return db.prepare(`
    SELECT c.id, c.mint, c.status, c.created_at_ms
    FROM candidates c
    WHERE c.created_at_ms <= ? AND c.created_at_ms > ?
      AND NOT EXISTS (
        SELECT 1 FROM shadow_outcomes s
        WHERE s.candidate_id = c.id AND s.checkpoint_min = ?
      )
    GROUP BY c.mint
    ORDER BY c.created_at_ms ASC
    LIMIT ?
  `).all(newest, oldest, checkpointMin, limit);
}

export function insertShadowOutcome(row) {
  return db.prepare(`
    INSERT OR IGNORE INTO shadow_outcomes
      (candidate_id, mint, candidate_status, checkpoint_min, at_ms,
       price_usd, mcap_usd, liquidity_usd, holder_count)
    VALUES
      (@candidate_id, @mint, @candidate_status, @checkpoint_min, @at_ms,
       @price_usd, @mcap_usd, @liquidity_usd, @holder_count)
  `).run(row);
}

export function shadowOutcomesForMint(mint) {
  return db.prepare(
    'SELECT * FROM shadow_outcomes WHERE mint = ? ORDER BY checkpoint_min ASC'
  ).all(mint);
}
