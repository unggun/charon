// Pure exit-decision logic shared by the live position monitor (refreshPosition)
// and the backtester. No DB, no network, no side effects: given a position
// state, a tick, and a strategy config, it returns updated water marks and any
// exit decision. Mirrors the order in src/execution/positions.js.

export function evaluateExit(position, tick, strat = {}) {
  const entryMcap = Number(position.entry_mcap);
  const mcap = Number(tick.mcap);
  const price = Number(tick.price);

  const highWaterMcap = Math.max(Number(position.high_water_mcap || 0), mcap);
  const highWaterPrice = Math.max(Number(position.high_water_price || 0), price || 0);
  const prevLowMcap = Number(position.low_water_mcap ?? position.entry_mcap ?? mcap);
  const prevLowPrice = Number(position.low_water_price ?? position.entry_price ?? price ?? 0);
  const lowWaterMcap = Math.min(prevLowMcap, mcap);
  const lowWaterPrice = price > 0 && prevLowPrice > 0
    ? Math.min(prevLowPrice, price)
    : (price || prevLowPrice);

  const mcapPnlPercent = (mcap / entryMcap - 1) * 100;
  // Only use the override when it is genuinely supplied (live Jupiter PnL).
  // Guard against null/undefined: Number(null) === 0 is finite and would
  // otherwise be mistaken for a real 0% override, masking the mcap-based PnL.
  const pnlOverride = tick.pnlPercentOverride;
  const pnlPercent = (pnlOverride != null && Number.isFinite(Number(pnlOverride)))
    ? Number(pnlOverride)
    : mcapPnlPercent;
  const peakPnlPercent = (highWaterMcap / entryMcap - 1) * 100;

  const trailingEnabled = Boolean(position.trailing_enabled);
  const trailingArmThreshold = Number(strat.trailing_arm_at_percent ?? 25);
  const trailingArmed = Boolean(position.trailing_armed)
    || (trailingEnabled && peakPnlPercent >= trailingArmThreshold);
  const trailDrop = highWaterMcap > 0 ? (mcap / highWaterMcap - 1) * 100 : 0;

  const tpHit = pnlPercent >= Number(position.tp_percent);
  const slHit = pnlPercent <= Number(position.sl_percent);
  const trailingHit = trailingArmed && trailingEnabled
    && trailDrop <= -Math.abs(Number(position.trailing_percent));

  let exitReason = null;
  if (Number(strat.max_hold_ms) > 0
      && (Number(tick.at_ms) - Number(position.opened_at_ms)) >= Number(strat.max_hold_ms)) {
    exitReason = 'MAX_HOLD';
  }

  let partialTpTriggered = false;
  if (!exitReason && strat.partial_tp && !position.partial_tp_done
      && pnlPercent >= Number(strat.partial_tp_at_percent)) {
    partialTpTriggered = true;
  }

  const rugGuardThreshold = Number(strat.rug_guard_drop_pct ?? 0);
  if (!exitReason && rugGuardThreshold > 0 && highWaterMcap > 0
      && trailDrop <= -rugGuardThreshold) {
    exitReason = 'RUG_GUARD';
  }

  if (!exitReason) {
    if (slHit) exitReason = 'SL';
    else if (tpHit && !trailingEnabled) exitReason = 'TP';
    else if (trailingHit) exitReason = 'TRAILING_TP';
  }

  return {
    exitReason,
    trailingArmed,
    partialTpTriggered,
    highWaterMcap,
    highWaterPrice,
    lowWaterMcap,
    lowWaterPrice,
    pnlPercent,
    peakPnlPercent,
    trailDrop,
  };
}
