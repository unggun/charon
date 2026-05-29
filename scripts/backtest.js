// Read-only exit-rule backtester. Replays recorded position_ticks through the
// same evaluateExit() the live monitor uses, under overridden strategy params.
// NEVER writes to the DB.
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initDb, db } from '../src/db/connection.js';
import { strategyById } from '../src/db/settings.js';
import { ticksForPosition } from '../src/db/ticks.js';
import { evaluateExit } from '../src/execution/exitLogic.js';

// Strategy fields that the position row also carries; overrides flow into both
// the effective strat (for evaluateExit thresholds) and the effective position
// (for SL/TP/trailing comparisons inside evaluateExit).
const POSITION_FIELDS = ['tp_percent', 'sl_percent', 'trailing_percent', 'trailing_enabled'];

export function simulate(position, ticks, strat) {
  if (!Number(position.entry_mcap)) {
    return { exitReason: 'NO_EXIT', pnlSol: 0, exitTickMs: ticks[ticks.length - 1]?.at_ms };
  }
  const pos = { ...position };
  for (const f of POSITION_FIELDS) {
    if (strat[f] !== undefined && strat[f] !== null) pos[f] = strat[f];
  }
  const state = {
    ...pos,
    high_water_mcap: pos.entry_mcap, high_water_price: pos.entry_price,
    low_water_mcap: pos.entry_mcap, low_water_price: pos.entry_price,
    trailing_armed: 0, partial_tp_done: 0,
  };
  const size = Number(position.size_sol);
  let realizedSol = 0;
  let remaining = 1;

  for (const t of ticks) {
    const ev = evaluateExit(state, { mcap: t.mcap, price: t.price, at_ms: t.at_ms }, strat);
    state.high_water_mcap = ev.highWaterMcap;
    state.high_water_price = ev.highWaterPrice;
    state.low_water_mcap = ev.lowWaterMcap;
    state.low_water_price = ev.lowWaterPrice;
    state.trailing_armed = ev.trailingArmed ? 1 : 0;

    if (ev.partialTpTriggered && !state.partial_tp_done) {
      state.partial_tp_done = 1;
      const sellFrac = remaining * (Number(strat.partial_tp_sell_percent) / 100);
      realizedSol += size * sellFrac * (ev.pnlPercent / 100);
      remaining -= sellFrac;
    }
    if (ev.exitReason) {
      realizedSol += size * remaining * (ev.pnlPercent / 100);
      return { exitReason: ev.exitReason, pnlSol: realizedSol, exitTickMs: t.at_ms };
    }
  }
  const last = ticks[ticks.length - 1];
  const lastPnl = last ? (last.mcap / Number(pos.entry_mcap) - 1) * 100 : 0;
  realizedSol += size * remaining * (lastPnl / 100);
  return { exitReason: 'NO_EXIT', pnlSol: realizedSol, exitTickMs: last?.at_ms };
}

export function summarize(rows) {
  const out = {
    count: rows.length, baselineSol: 0, simulatedSol: 0,
    baselineWins: 0, simWins: 0, simExitReasons: {},
  };
  for (const { position, sim } of rows) {
    out.baselineSol += Number(position.pnl_sol || 0);
    out.simulatedSol += sim.pnlSol;
    if (Number(position.pnl_sol || 0) > 0) out.baselineWins += 1;
    if (sim.pnlSol > 0) out.simWins += 1;
    out.simExitReasons[sim.exitReason] = (out.simExitReasons[sim.exitReason] || 0) + 1;
  }
  return out;
}

function parseWindowMs(s) {
  const m = String(s).match(/^(\d+)([mhd])$/);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = Number(m[1]);
  return n * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

function parseArgs(argv) {
  const a = { strategy: null, window: '7d', overrides: {}, sweep: null };
  const flagMap = {
    '--sl': 'sl_percent', '--tp': 'tp_percent', '--trail': 'trailing_percent',
    '--arm': 'trailing_arm_at_percent', '--rug': 'rug_guard_drop_pct',
    '--partial-at': 'partial_tp_at_percent', '--partial-sell': 'partial_tp_sell_percent',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--strategy') a.strategy = argv[++i];
    else if (k === '--window') a.window = argv[++i];
    else if (k === '--sweep') a.sweep = argv[++i]; // e.g. sl=-15,-20,-25
    else if (flagMap[k]) a.overrides[flagMap[k]] = Number(argv[++i]);
  }
  return a;
}

function loadRows(strategyId, windowMs) {
  const since = Date.now() - windowMs;
  const positions = db.prepare(`
    SELECT * FROM dry_run_positions
    WHERE status = 'closed' AND closed_at_ms >= ?
      AND (? IS NULL OR strategy_id = ?)
    ORDER BY closed_at_ms ASC
  `).all(since, strategyId, strategyId);
  return positions
    .map((position) => ({ position, ticks: ticksForPosition(position.id) }))
    .filter((r) => r.ticks.length > 0);
}

function fmt(n) { return (n >= 0 ? '+' : '') + Number(n).toFixed(4); }

function runOnce(rows, baseStratId, overrides) {
  const out = rows.map(({ position, ticks }) => {
    const strat = { ...strategyById(position.strategy_id || baseStratId), ...overrides };
    return { position, sim: simulate(position, ticks, strat) };
  });
  return summarize(out);
}

function main() {
  initDb();
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows(args.strategy, parseWindowMs(args.window));
  if (rows.length === 0) {
    console.log('No closed positions with ticks in window. Ticks are recorded only for positions opened after the feature shipped.');
    return;
  }
  console.log(`Backtesting ${rows.length} closed positions (strategy=${args.strategy || 'all'}, window=${args.window}).`);
  console.log('NOTE: fidelity bound by tick cadence (~10s) and Jupiter latency; no slippage/fee model. Relative comparison only.\n');

  if (args.sweep) {
    const [field, listRaw] = args.sweep.split('=');
    if (!listRaw) {
      console.error('--sweep requires format field=v1,v2 (e.g. sl=-15,-20,-25)');
      return;
    }
    const flagMap = { sl: 'sl_percent', tp: 'tp_percent', trail: 'trailing_percent', arm: 'trailing_arm_at_percent', rug: 'rug_guard_drop_pct' };
    const key = flagMap[field] || field;
    const baseline = summarize(rows.map(({ position }) => ({ position, sim: { pnlSol: Number(position.pnl_sol || 0), exitReason: position.exit_reason } })));
    console.log(`baseline           total=${fmt(baseline.baselineSol)} wins=${baseline.baselineWins}/${baseline.count}`);
    for (const v of listRaw.split(',')) {
      const s = runOnce(rows, args.strategy, { ...args.overrides, [key]: Number(v) });
      console.log(`${key}=${String(v).padEnd(8)} total=${fmt(s.simulatedSol)} wins=${s.simWins}/${s.count} exits=${JSON.stringify(s.simExitReasons)}`);
    }
    return;
  }

  const s = runOnce(rows, args.strategy, args.overrides);
  console.log(`baseline (actual)  total=${fmt(s.baselineSol)} wins=${s.baselineWins}/${s.count}`);
  console.log(`simulated          total=${fmt(s.simulatedSol)} wins=${s.simWins}/${s.count}`);
  console.log(`delta              ${fmt(s.simulatedSol - s.baselineSol)} SOL`);
  console.log(`sim exit reasons   ${JSON.stringify(s.simExitReasons)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
