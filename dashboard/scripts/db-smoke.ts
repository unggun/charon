import { db } from "../src/lib/db";

const row = db
  .prepare(
    "SELECT COUNT(*) AS n, SUM(pnl_sol) AS pnl FROM dry_run_positions WHERE status = 'closed'"
  )
  .get() as { n: number; pnl: number | null };

console.log(`closed positions: ${row.n}, total realized PnL: ${row.pnl?.toFixed(4)} SOL`);
