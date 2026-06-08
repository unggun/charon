// Read-only entry-filter replay. Re-runs filterCandidate() over every recorded
// candidate snapshot under proposed strategy tunings to size the impact of a
// gate change BEFORE it goes live. NEVER writes to the DB.
import process from 'node:process';
import { initDb, db } from '../src/db/connection.js';
import { strategyById } from '../src/db/settings.js';
import { filterCandidate } from '../src/pipeline/candidateBuilder.js';

initDb();

const liveDegen = strategyById('degen');

// Candidate tunings layered on top of the live degen row.
const CONFIGS = {
  'live (current row)': { ...liveDegen },
  'mcap150k + single40 + top20off': {
    ...liveDegen, max_mcap_usd: 150000, max_single_holder_percent: 40, max_top20_holder_percent: 100,
  },
  'mcap150k + single40 + top20<=70': {
    ...liveDegen, max_mcap_usd: 150000, max_single_holder_percent: 40, max_top20_holder_percent: 70,
  },
  'mcap150k + single40 + top20<=70 + organic relaxed(0)': {
    ...liveDegen, max_mcap_usd: 150000, max_single_holder_percent: 40, max_top20_holder_percent: 70, min_organic_score: 0,
  },
};

const WATCH = {
  'FIN Lil Finder Guy (RAN +262%)': '87UGfmKKFjvWRCpFRgpKtRdrj1gVwkqebdxLnAAPpump',
  'FIN Apple Companion (RUGGED -92%)': 'FNj8ScidSVdw17xJWETEyrXaKSsGLrjL6gMjg671pump',
  'CHIPOTLAI (success)': 'ES6ZcfTUTVET37RaYW9qDhX1DBBDEaTuvg87Lw9epump',
};

const rows = db.prepare('SELECT mint, candidate_json FROM candidates').all();
const candidates = rows.map(r => ({ mint: r.mint, c: JSON.parse(r.candidate_json) }));

console.log(`Replaying ${candidates.length} candidate snapshots\n`);

for (const [name, strat] of Object.entries(CONFIGS)) {
  let pass = 0;
  const passMints = new Set();
  for (const { mint, c } of candidates) {
    if (filterCandidate(c, strat).passed) { pass++; passMints.add(mint); }
  }
  console.log(`### ${name}`);
  console.log(`    total snapshots passing: ${pass}/${candidates.length}  (${(100*pass/candidates.length).toFixed(1)}%), distinct mints: ${passMints.size}`);
  for (const [label, mint] of Object.entries(WATCH)) {
    const snaps = candidates.filter(x => x.mint === mint);
    const passing = snaps.filter(x => filterCandidate(x.c, strat).passed);
    const verdict = passing.length ? `WOULD ENTER (${passing.length}/${snaps.length} snaps)` : 'still filtered';
    let firstMcap = '';
    if (passing.length) {
      const mc = passing.map(x => x.c.metrics?.marketCapUsd).filter(Number.isFinite).sort((a,b)=>a-b)[0];
      firstMcap = `  cheapest pass mcap=$${Math.round(mc).toLocaleString()}`;
    }
    console.log(`      - ${label}: ${verdict}${firstMcap}`);
  }
  console.log();
}
