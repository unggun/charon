import { now } from '../utils.js';
import { fetchJupiterAsset } from '../enrichment/jupiter.js';
import {
  SHADOW_CHECKPOINTS_MIN,
  dueShadowCandidates,
  insertShadowOutcome,
} from '../db/shadowOutcomes.js';

const PER_CYCLE_FETCH_CAP = 12;

// Samples mcap/liquidity/holders for every candidate (filtered AND taken) at
// 30/60/120 min after it was first seen. Filtered candidates have no
// position_ticks, so this is the only outcome data we get for them — it is
// what lets us measure the opportunity cost of a gate before tightening it.
export async function trackShadowOutcomes() {
  const nowMs = now();
  let fetches = 0;
  for (const checkpointMin of SHADOW_CHECKPOINTS_MIN) {
    if (fetches >= PER_CYCLE_FETCH_CAP) break;
    const due = dueShadowCandidates(checkpointMin, nowMs, PER_CYCLE_FETCH_CAP - fetches);
    for (const cand of due) {
      const asset = await fetchJupiterAsset(cand.mint);
      fetches += 1;
      // null asset = fetch failed or backoff active; leave the row missing so
      // the next cycle retries until the grace window expires.
      if (!asset) continue;
      insertShadowOutcome({
        candidate_id: cand.id,
        mint: cand.mint,
        candidate_status: cand.status,
        checkpoint_min: checkpointMin,
        at_ms: nowMs,
        price_usd: Number.isFinite(Number(asset.usdPrice)) ? Number(asset.usdPrice) : null,
        mcap_usd: Number.isFinite(Number(asset.mcap ?? asset.fdv)) ? Number(asset.mcap ?? asset.fdv) : null,
        liquidity_usd: Number.isFinite(Number(asset.liquidity)) ? Number(asset.liquidity) : null,
        holder_count: Number.isFinite(Number(asset.holderCount)) ? Number(asset.holderCount) : null,
      });
      if (fetches >= PER_CYCLE_FETCH_CAP) break;
    }
  }
  return fetches;
}
