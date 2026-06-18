// Read-only post-deploy trade analysis for the 5m-momentum + mcap entry gates
// (commit 35eaabe, deployed 2026-06-18). Reports closed-trade outcomes by entry
// cohort so we can confirm the gates are helping on a fresh dry-run window.
// NEVER writes to the DB.
//
// Usage:
//   node scripts/analyze_gates.js                 # window = since deploy (2026-06-18)
//   node scripts/analyze_gates.js --since 2026-06-25
//   node scripts/analyze_gates.js --since 2026-06-01 --until 2026-06-18   # pre-deploy baseline
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { initDb, db } from '../src/db/connection.js';
import { deriveJupiterMetrics } from '../src/pipeline/candidateBuilder.js';

const DEPLOY_DAY = '2026-06-18';

function parseArgs(argv) {
  const out = { since: DEPLOY_DAY, until: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') out.since = argv[++i];
    else if (argv[i] === '--until') out.until = argv[++i];
  }
  return out;
}

function dayToMs(day) {
  // interpret YYYY-MM-DD as UTC midnight
  return Date.parse(`${day}T00:00:00Z`);
}

// priceChange5m is stored directly on post-deploy snapshots; for older rows we
// reconstruct it from jupiterAsset the same way buildCandidate now does.
function priceChange5m(candidate) {
  const stored = candidate?.metrics?.priceChange5m;
  if (Number.isFinite(stored)) return stored;
  return deriveJupiterMetrics(candidate?.jupiterAsset, candidate?.trending).priceChange5m;
}

export function loadClosed(sinceMs, untilMs) {
  const rows = db.prepare(`
    SELECT pnl_percent, pnl_sol, exit_reason, snapshot_json
    FROM dry_run_positions
    WHERE status = 'closed'
      AND closed_at_ms >= ?
      AND (? IS NULL OR closed_at_ms < ?)
  `).all(sinceMs, untilMs, untilMs);
  return rows.map((r) => {
    const candidate = JSON.parse(r.snapshot_json).candidate || {};
    return {
      pnlPct: Number(r.pnl_percent || 0),
      pnlSol: Number(r.pnl_sol || 0),
      win: Number(r.pnl_percent || 0) > 0 ? 1 : 0,
      exitReason: r.exit_reason,
      ch5m: priceChange5m(candidate),
      mcap: candidate?.metrics?.marketCapUsd ?? null,
    };
  });
}

function fmt(n) { return (n >= 0 ? '+' : '') + n.toFixed(4); }

function summarize(recs) {
  const n = recs.length;
  const wins = recs.reduce((s, r) => s + r.win, 0);
  const net = recs.reduce((s, r) => s + r.pnlSol, 0);
  return { n, wins, winPct: n ? (wins / n) * 100 : 0, net };
}

function cohortTable(recs, label, field, edges) {
  console.log(`\n=== ${label} ===`);
  const present = recs.filter((r) => Number.isFinite(r[field]));
  const missing = recs.length - present.length;
  const bounds = [-Infinity, ...edges, Infinity];
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    const sub = present.filter((r) => r[field] >= lo && r[field] < hi);
    if (!sub.length) continue;
    const s = summarize(sub);
    let bin = `[${lo},${hi})`;
    if (lo === -Infinity) bin = `<${hi}`;
    if (hi === Infinity) bin = `>=${lo}`;
    console.log(`  ${bin.padStart(14)}  n=${String(s.n).padStart(3)}  win=${s.winPct.toFixed(0).padStart(3)}%  net=${fmt(s.net)}`);
  }
  if (missing) console.log(`  ${'(missing)'.padStart(14)}  n=${String(missing).padStart(3)}`);
}

function exitTable(recs) {
  console.log('\n=== by exit reason ===');
  const byReason = new Map();
  for (const r of recs) {
    const e = byReason.get(r.exitReason) || [];
    e.push(r); byReason.set(r.exitReason, e);
  }
  for (const [reason, sub] of [...byReason.entries()].sort((a, b) => summarize(b[1]).net - summarize(a[1]).net)) {
    const s = summarize(sub);
    console.log(`  ${String(reason).padStart(12)}  n=${String(s.n).padStart(3)}  win=${s.winPct.toFixed(0).padStart(3)}%  net=${fmt(s.net)}`);
  }
}

export function report(args) {
  const sinceMs = dayToMs(args.since);
  const untilMs = args.until ? dayToMs(args.until) : null;
  const recs = loadClosed(sinceMs, untilMs);
  const window = `${args.since}${args.until ? ` .. ${args.until}` : ' .. now'}`;

  console.log(`Charon gate analysis — window ${window}`);
  if (!recs.length) {
    console.log('\nNo closed trades in this window yet. (Throughput may be low under the tightened gates — widen --since or wait for more samples.)');
    return;
  }
  const all = summarize(recs);
  console.log(`\nOVERALL  n=${all.n}  win=${all.winPct.toFixed(0)}%  net=${fmt(all.net)} SOL  avg=${fmt(all.net / all.n)}/trade`);

  // The pre-deploy June baseline for reference (see project memory): n=138, 37% win, -0.2726 SOL.
  console.log('REFERENCE (pre-deploy Jun 1-18): n=138  win=37%  net=-0.2726 SOL  avg=-0.0020/trade');

  cohortTable(recs, '5m momentum at entry (priceChange5m %)', 'ch5m', [-20, -5, 0, 5, 20]);
  cohortTable(recs, 'entry market cap (USD)', 'mcap', [20000, 50000, 75000, 100000]);
  exitTable(recs);

  // Verdict: are positive-5m entries actually gone? (max_change5m_pct=0 should
  // mean ~no trades with ch5m>0; any that slip through are worth investigating.)
  const positive5m = recs.filter((r) => Number.isFinite(r.ch5m) && r.ch5m > 0);
  console.log('\n=== gate sanity ===');
  console.log(`  trades with 5m change > 0 (gate should block these): ${positive5m.length}/${recs.length}`);
  if (positive5m.length) {
    const s = summarize(positive5m);
    console.log(`    -> net from those: ${fmt(s.net)} (if non-zero, check the gate / data freshness)`);
  }
  console.log(`\nVERDICT: net ${fmt(all.net)} SOL over ${all.n} trades vs pre-deploy -0.2726 over 138 ` +
    `(avg ${fmt(all.net / all.n)} vs -0.0020). ${all.net / all.n > -0.0020 ? 'Gates improving per-trade EV.' : 'No improvement yet — revisit thresholds.'}`);
}

function main() {
  initDb();
  report(parseArgs(process.argv.slice(2)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
