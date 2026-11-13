import { assetCoversPeriod } from "../domain/data";
import { geometricMean, volatility } from "../domain/metrics";
import type { Asset, Mode, Row } from "../domain/types";
import type { AllocationProfileId } from "./profiles";

/**
 * Stage 1 of the suggested portfolios: select a manageable, diversified shortlist
 * from every historical asset that fully covers the SAME comparison period.
 *
 * This is a deterministic ranking heuristic, not a joint optimal subset search.
 * Stage 2 uses the existing optimization engine to determine portfolio weights.
 */
export interface SuggestedAssetSelection {
  ids: string[];
  eligibleCount: number;
  excludedCount: number;
  diagnostics: string[];
}

type Candidate = {
  id: string;
  cagr: number;
  vol: number;
  drawdown: number;  // positive magnitude
  worstYear: number; // observed annual percentage return
  annualReturns: number[];
  score: number;
};

function correlation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 1;
  const ml = left.reduce((sum, x) => sum + x, 0) / left.length;
  const mr = right.reduce((sum, x) => sum + x, 0) / right.length;
  let covariance = 0, ll = 0, rr = 0;
  left.forEach((x, i) => {
    const a = x - ml, b = right[i] - mr;
    covariance += a * b;
    ll += a * a;
    rr += b * b;
  });
  return ll > 0 && rr > 0 ? covariance / Math.sqrt(ll * rr) : 0;
}

function historicalDrawdown(returns: number[]): number {
  let wealth = 1, peak = 1, worst = 0;
  for (const pct of returns) {
    wealth *= 1 + pct / 100;
    peak = Math.max(peak, wealth);
    worst = Math.max(worst, (1 - wealth / peak) * 100);
  }
  return worst;
}

function percentile(value: number, values: number[], ascending: boolean): number {
  if (values.length < 2) return 0.5;
  const ordered = [...values].sort((a, b) => ascending ? a - b : b - a);
  const rank = ordered.findIndex(v => v === value);
  return 1 - rank / (ordered.length - 1);
}

export function suggestProfileAssets(
  assets: Asset[],
  data: Record<string, Row[]>,
  start: number,
  end: number,
  mode: Mode,
  profile: AllocationProfileId,
  maxAssets = 6,
): SuggestedAssetSelection {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end - start + 1 < 10) {
    return { ids: [], eligibleCount: 0, excludedCount: assets.length,
      diagnostics: ["La présélection automatique demande au moins 10 années communes."] };
  }

  const candidates: Candidate[] = [];
  for (const asset of assets) {
    const rows = data[asset.id];
    if (!assetCoversPeriod(rows, start, end, mode)) continue;
    const returns = rows.filter(r => r.year >= start && r.year <= end && Number.isFinite(r[mode]))
      .map(r => r[mode]);
    const cagr = geometricMean(returns);
    const vol = volatility(returns);
    if (cagr === null || !Number.isFinite(vol) || !returns.length) continue;
    candidates.push({
      id: asset.id, cagr, vol, drawdown: historicalDrawdown(returns),
      worstYear: Math.min(...returns), annualReturns: returns, score: 0,
    });
  }

  if (!candidates.length) return {
    ids: [], eligibleCount: 0, excludedCount: assets.length,
    diagnostics: ["Aucun actif ne couvre entièrement la fenêtre choisie."],
  };

  const cagrs = candidates.map(x => x.cagr);
  const vols = candidates.map(x => x.vol);
  const drawdowns = candidates.map(x => x.drawdown);
  const worstYears = candidates.map(x => x.worstYear);

  // Normalized ranks avoid treating percentage-point scales as commensurable.
  const weights = profile === "growth" ? [0.90, 0.05, 0.05, 0] :
    profile === "controlled" ? [0.45, 0.25, 0.30, 0] :
    profile === "robust" ? [0.25, 0.20, 0.20, 0.35] :
    [0.55, 0.20, 0.25, 0];
  candidates.forEach(x => {
    const ranks = [
      percentile(x.cagr, cagrs, false),
      percentile(x.vol, vols, true),
      percentile(x.drawdown, drawdowns, true),
      percentile(x.worstYear, worstYears, false),
    ];
    x.score = ranks.reduce((sum, value, index) => sum + value * weights[index], 0);
  });

  // Greedy diversity discount: an index nearly identical to an already chosen
  // index is less useful than a genuinely distinct return stream.
  const selected: Candidate[] = [];
  const remaining = [...candidates];
  while (remaining.length && selected.length < maxAssets) {
    const ranked = remaining.map(candidate => {
      const maxPositiveCorrelation = selected.length
        ? Math.max(...selected.map(chosen => correlation(candidate.annualReturns, chosen.annualReturns)))
        : 0;
      const redundant = Math.max(0, (maxPositiveCorrelation - 0.75) / 0.25);
      return { candidate, adjustedScore: candidate.score - 0.40 * redundant };
    }).sort((a, b) => b.adjustedScore - a.adjustedScore || a.candidate.id.localeCompare(b.candidate.id));
    const best = ranked[0].candidate;
    selected.push(best);
    remaining.splice(remaining.indexOf(best), 1);
  }

  return {
    ids: selected.map(x => x.id),
    eligibleCount: candidates.length,
    excludedCount: assets.length - candidates.length,
    diagnostics: [
      "Présélection heuristique selon rendement, risque et redondance historique. Les pondérations sont optimisées séparément.",
      ...(end - start + 1 < 20 ? ["Fenêtre courte : résultats particulièrement sensibles à la période."] : []),
    ],
  };
}
