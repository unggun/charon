export function classifyStage(strat, candidate) {
  const threshold = strat?.early_stage_mcap_threshold_usd ?? 30000;
  const mcap = candidate?.metrics?.marketCapUsd ?? 0;
  return mcap < threshold ? 'early' : 'main';
}

export function pickStageGate(strat, candidate, field) {
  const stage = classifyStage(strat, candidate);
  if (stage === 'early') {
    const earlyKey = `early_${field}`;
    if (strat[earlyKey] !== null && strat[earlyKey] !== undefined) {
      return strat[earlyKey];
    }
  }
  return strat[field];
}
