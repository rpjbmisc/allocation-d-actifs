import { alignAnnualSeries } from "../domain/data";
import { normalizeWeights } from "../domain/constraints";
import { geometricMean } from "../domain/metrics";
import { returnValue } from "../domain/returns";
import type { Mode, Row } from "../domain/types";

export interface ScenarioSettings {
  /** Number of joint historical paths generated for each allocation. */
  scenarioCount: number;
  /** Number of annual observations in each simulated path. */
  horizonYears: number;
  /** Consecutive historical years sampled together for all assets. */
  blockYears: number;
  /** Integer seed used by the deterministic pseudo-random generator. */
  seed: number;
  /** Lower empirical quantile used as the robust objective, in percent. */
  quantilePct: number;
}

export const DEFAULT_SCENARIO_SETTINGS: ScenarioSettings = {
  scenarioCount: 250,
  horizonYears: 10,
  blockYears: 1,
  seed: 20261021,
  quantilePct: 20,
};

export interface ScenarioInput {
  data: Record<string, Row[]>;
  assetIds: string[];
  start: number;
  end: number;
  mode: Mode;
}

export interface JointScenario {
  index: number;
  /** Source years are retained to make the bootstrap auditable. */
  sourceYears: number[];
  annualReturns: Record<string, number[]>;
}

export interface ScenarioGenerationResult {
  settings: ScenarioSettings;
  historicalYears: number[];
  scenarios: JointScenario[];
  diagnostics: string[];
}

export interface ScenarioSummary {
  scenarioCount: number;
  horizonYears: number;
  blockYears: number;
  seed: number;
  quantilePct: number;
  quantileCagr: number;
  medianCagr: number;
  worstCagr: number;
  bestCagr: number;
  /** Median minus the selected lower quantile, in annualized percentage points. */
  fragilityCagr: number;
}

function mergedSettings(rawSettings?: Partial<ScenarioSettings>): ScenarioSettings {
  return { ...DEFAULT_SCENARIO_SETTINGS, ...rawSettings };
}

export function validateScenarioSettings(rawSettings?: Partial<ScenarioSettings>): { settings: ScenarioSettings; diagnostics: string[] } {
  const settings = mergedSettings(rawSettings);
  const diagnostics: string[] = [];
  if (!Number.isInteger(settings.scenarioCount) || settings.scenarioCount < 1 || settings.scenarioCount > 10_000) {
    diagnostics.push("Le nombre de scénarios doit être un entier compris entre 1 et 10 000.");
  }
  if (!Number.isInteger(settings.horizonYears) || settings.horizonYears < 1 || settings.horizonYears > 1_000) {
    diagnostics.push("L'horizon des scénarios doit être un entier compris entre 1 et 1 000 ans.");
  }
  if (!Number.isInteger(settings.blockYears) || settings.blockYears < 1) {
    diagnostics.push("La taille des blocs historiques doit être un entier positif.");
  }
  if (!Number.isInteger(settings.seed) || !Number.isFinite(settings.seed)) {
    diagnostics.push("La graine des scénarios doit être un entier fini.");
  }
  if (!Number.isFinite(settings.quantilePct) || settings.quantilePct < 0 || settings.quantilePct > 50) {
    diagnostics.push("Le quantile défavorable doit être compris entre 0 % et 50 %.");
  }
  return { settings, diagnostics };
}

/** Small deterministic generator; randomness is never taken from the browser clock. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Resample consecutive annual vectors. Every asset uses the same source year
 * at each simulated step, preserving the observed cross-asset co-movement.
 */
export function generateJointScenarios(input: ScenarioInput, rawSettings?: Partial<ScenarioSettings>): ScenarioGenerationResult {
  const { settings, diagnostics: settingsDiagnostics } = validateScenarioSettings(rawSettings);
  if (settingsDiagnostics.length) return { settings, historicalYears: [], scenarios: [], diagnostics: settingsDiagnostics };

  const aligned = alignAnnualSeries(input.data, input.assetIds, input.start, input.end, input.mode);
  if (!aligned.ok) return {
    settings,
    historicalYears: [],
    scenarios: [],
    diagnostics: aligned.diagnostics.map(diagnostic => diagnostic.message),
  };
  if (settings.blockYears > aligned.years.length) return {
    settings,
    historicalYears: aligned.years,
    scenarios: [],
    diagnostics: ["La taille des blocs dépasse le nombre d'années historiques disponibles."],
  };

  const random = seededRandom(settings.seed);
  const maxStartIndex = aligned.years.length - settings.blockYears;
  const scenarios = Array.from({ length: settings.scenarioCount }, (_, index) => {
    const sourceYears: number[] = [];
    const annualReturns = Object.fromEntries(input.assetIds.map(id => [id, [] as number[]]));
    while (sourceYears.length < settings.horizonYears) {
      const blockStart = Math.floor(random() * (maxStartIndex + 1));
      const blockLength = Math.min(settings.blockYears, settings.horizonYears - sourceYears.length);
      for (let offset = 0; offset < blockLength; offset += 1) {
        const sourceYear = aligned.years[blockStart + offset];
        sourceYears.push(sourceYear);
        input.assetIds.forEach(id => {
          const row = aligned.rowsByAsset[id].get(sourceYear);
          annualReturns[id].push(returnValue(row!, input.mode) as number);
        });
      }
    }
    return { index, sourceYears, annualReturns };
  });

  return { settings, historicalYears: aligned.years, scenarios, diagnostics: [] };
}

function empiricalQuantile(values: number[], quantilePct: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * quantilePct / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function scenarioPortfolioCagr(scenario: JointScenario, weights: Record<string, number>): number | null {
  const normalized = normalizeWeights(weights);
  if (!normalized) return null;
  const horizon = Object.values(scenario.annualReturns)[0]?.length ?? 0;
  if (!horizon || Object.keys(normalized).some(id => (scenario.annualReturns[id]?.length ?? 0) !== horizon)) return null;
  const returns = Array.from({ length: horizon }, (_, index) => Object.entries(normalized).reduce(
    (total, [id, weight]) => total + weight * scenario.annualReturns[id][index],
    0,
  ));
  return geometricMean(returns);
}

export function summarizeScenarioPortfolio(
  scenarios: JointScenario[],
  weights: Record<string, number>,
  settings: ScenarioSettings,
): ScenarioSummary | null {
  const cagrs = scenarios.map(scenario => scenarioPortfolioCagr(scenario, weights));
  if (!cagrs.length || cagrs.some(cagr => cagr === null || !Number.isFinite(cagr))) return null;
  const values = cagrs as number[];
  const quantileCagr = empiricalQuantile(values, settings.quantilePct);
  const medianCagr = empiricalQuantile(values, 50);
  return {
    scenarioCount: values.length,
    horizonYears: settings.horizonYears,
    blockYears: settings.blockYears,
    seed: settings.seed,
    quantilePct: settings.quantilePct,
    quantileCagr,
    medianCagr,
    worstCagr: Math.min(...values),
    bestCagr: Math.max(...values),
    fragilityCagr: medianCagr - quantileCagr,
  };
}
