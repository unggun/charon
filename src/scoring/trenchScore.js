function sourcesScore(candidate) {
  const n = Number(candidate?.signals?.sourceCount ?? 0);
  const capped = Math.max(0, Math.min(n, 3));
  return capped * (25 / 3);
}

function distributionScore(candidate) {
  const top = Number(candidate?.holders?.maxHolderPercent ?? 100);
  const clamped = Math.max(0, Math.min(top, 100));
  return ((100 - clamped) / 100) * 25;
}

function bundlerScore(candidate) {
  const rate = Number(candidate?.trending?.bundler_rate ?? 1);
  const clamped = Math.max(0, Math.min(rate, 1));
  return (1 - clamped) * 15;
}

function feeClaimScore(candidate) {
  const sol = Number(candidate?.feeClaim?.distributedSol ?? 0);
  if (sol <= 0) return 0;
  const ratio = Math.log1p(sol) / Math.log1p(5);
  return Math.min(ratio, 1) * 15;
}

function holdersScore(candidate) {
  const h = Number(candidate?.metrics?.holderCount ?? 0);
  if (h <= 0) return 0;
  const ratio = Math.log1p(h) / Math.log1p(500);
  return Math.min(ratio, 1) * 10;
}

function athPullbackScore(candidate) {
  const dist = Number(candidate?.chart?.distanceFromAthPercent ?? 0);
  const magnitude = Math.abs(dist);
  const ratio = Math.min(magnitude / 30, 1);
  return ratio * 10;
}

export function computeTrenchScore(candidate) {
  const components = {
    sources:      sourcesScore(candidate),
    distribution: distributionScore(candidate),
    bundler:      bundlerScore(candidate),
    feeClaim:     feeClaimScore(candidate),
    holders:      holdersScore(candidate),
    athPullback:  athPullbackScore(candidate),
  };
  const sum =
    components.sources + components.distribution + components.bundler +
    components.feeClaim + components.holders + components.athPullback;
  const total = Math.max(0, Math.min(100, sum));
  return { total, components };
}
