import { db } from './connection.js';

const insertStmt = () => db.prepare(`
  INSERT INTO position_ticks
    (position_id, mint, at_ms, ms_since_open, price, mcap, pnl_percent,
     high_water_mcap, low_water_mcap, trailing_armed, liquidity_usd, holder_count,
     holder_change_5m, buys_5m, sells_5m, buy_vol_5m, sell_vol_5m,
     price_change_5m, top_holders_pct, bot_holders_pct, bundler_holding_pct)
  VALUES
    (@position_id, @mint, @at_ms, @ms_since_open, @price, @mcap, @pnl_percent,
     @high_water_mcap, @low_water_mcap, @trailing_armed, @liquidity_usd, @holder_count,
     @holder_change_5m, @buys_5m, @sells_5m, @buy_vol_5m, @sell_vol_5m,
     @price_change_5m, @top_holders_pct, @bot_holders_pct, @bundler_holding_pct)
`);

export function insertPositionTick(tick) {
  insertStmt().run(tick);
}

export function ticksForPosition(positionId) {
  return db.prepare(
    'SELECT * FROM position_ticks WHERE position_id = ? ORDER BY at_ms ASC'
  ).all(positionId);
}

export function pruneTicks(olderThanMs) {
  return db.prepare(`
    DELETE FROM position_ticks WHERE position_id IN (
      SELECT id FROM dry_run_positions
      WHERE status = 'closed' AND closed_at_ms IS NOT NULL AND closed_at_ms < ?
    )
  `).run(olderThanMs).changes;
}
