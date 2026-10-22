import { alignAnnualSeries } from "../domain/data";
import { returnValue } from "../domain/returns";
import { generateJointScenarios } from "./generator";
import type { JointScenario, ScenarioInput, ScenarioSettings } from "./generator";

/**
 * Forward-looking WHAT-IF experiments, NOT forecasts.
 * All shifts are percentage points of ANNUAL returns in the selected currency
 * and nominal/real mode. They are NOT historical estimates or calibrated views.
 */
export type MacroObjective = "average" | "worst" | "regret";

export interface MacroRegime {
  id: string;
  name: string;
  description: string;
  shiftsPct: Record<string, number>;
  /** 1 keeps historical fluctuations; >1 amplifies them. */
  volatilityMultiplier: number;
  /** Extra common historical equity fluctuation (heuristic correlation stress). */
  equityShockMultiplier: number;
}

export interface ProspectiveSettings {
  enabled: boolean;
  objective: MacroObjective;
  pathsPerRegime: number;
  regimes: MacroRegime[];
}

type AssetKind = "us" | "developed" | "international" | "emerging" | "gold" | "bonds" | "cash" | "credit" | "reit" | "infrastructure" | "bitcoin";

const KINDS: Record<string, AssetKind> = {
  sp500: "us", us_total_market: "us", russell2000: "us",
  msci_world: "developed", msci_world_value: "developed", msci_world_small_cap_value: "developed",
  msci_world_ex_usa: "international", msci_em: "emerging",
  gold: "gold", tbills_us: "cash", us_lt_govt_bonds: "bonds",
  us_corp_bonds_ig: "credit", highyield_us: "credit",
  reit_us: "reit", global_infrastructure: "infrastructure", bitcoin: "bitcoin",
};

const ALL_ASSETS = Object.keys(KINDS);

function preset(
  id: string,
  name: string,
  description: string,
  kinds: Record<AssetKind, number>,
  volatilityMultiplier: number,
  equityShockMultiplier: number,
): MacroRegime {
  return {
    id, name, description,
    shiftsPct: Object.fromEntries(ALL_ASSETS.map(asset => [asset, kinds[KINDS[asset]]])),
    volatilityMultiplier, equityShockMultiplier,
  };
}

/** Deliberately illustrative assumptions: users must review them. */
export function defaultMacroRegimes(): MacroRegime[] {
  return [
    preset("us-growth", "Croissance américaine", "Les actions américaines restent dynamiques.",
      { us: 3, developed: 2, international: 0, emerging: 1, gold: -1, bonds: -1, cash: 0, credit: 1, reit: 1, infrastructure: 1, bitcoin: 2 }, 0.9, 0),
    preset("rotation", "Rotation internationale", "Les marchés hors États-Unis font mieux que les actions américaines.",
      { us: -4, developed: -2, international: 3, emerging: 4, gold: 1, bonds: 0, cash: 0, credit: 0, reit: -1, infrastructure: 1, bitcoin: -2 }, 1, 0),
    preset("inflation", "Inflation durable", "Inflation et taux élevés pèsent sur plusieurs marchés.",
      { us: -4, developed: -3, international: -2, emerging: -1, gold: 5, bonds: -4, cash: 1, credit: -3, reit: -3, infrastructure: 1, bitcoin: -1 }, 1.2, 0.15),
    preset("crisis", "Crise prolongée", "Les actifs risqués subissent un choc plus général.",
      { us: -7, developed: -6, international: -5, emerging: -8, gold: 2, bonds: 2, cash: 1, credit: -5, reit: -7, infrastructure: -4, bitcoin: -10 }, 1.3, 0.35),
  ];
}

export function defaultProspectiveSettings(): ProspectiveSettings {
  return { enabled: false, objective: "regret", pathsPerRegime: 80, regimes: defaultMacroRegimes() };
}

export interface RegimeScenarioSet {
  regime: MacroRegime;
  scenarios: JointScenario[];
}

export interface MacroScenarioResult {
  sets: RegimeScenarioSet[];
  diagnostics: string[];
  clippedValues: number;
}

const equityExposure = (id: string): number => {
  const kind = KINDS[id];
  return kind === "us" || kind === "developed" || kind === "international" || kind === "emerging" ? 1
    : kind === "reit" ? 0.8 : kind === "infrastructure" ? 0.6 : kind === "bitcoin" ? 0.5 : 0;
};

export function validateProspectiveSettings(settings: ProspectiveSettings, assetIds: string[]): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(settings.pathsPerRegime) || settings.pathsPerRegime < 1 || settings.pathsPerRegime > 500) errors.push("Le nombre de simulations par scénario économique doit être entre 1 et 500.");
  if (!["average", "worst", "regret"].includes(settings.objective)) errors.push("Objectif de comparaison inconnu.");
  if (settings.regimes.length !== 4 || new Set(settings.regimes.map(r => r.id)).size !== 4) errors.push("Il faut quatre scénarios économiques distincts.");
  for (const regime of settings.regimes) {
    if (!Number.isFinite(regime.volatilityMultiplier) || regime.volatilityMultiplier < 0 || regime.volatilityMultiplier > 3) errors.push(`Intensité des variations invalide : ${regime.name}.`);
    if (!Number.isFinite(regime.equityShockMultiplier) || regime.equityShockMultiplier < 0 || regime.equityShockMultiplier > 2) errors.push(`Choc commun invalide : ${regime.name}.`);
    for (const id of assetIds) {
      const shift = regime.shiftsPct[id] ?? 0;
      if (!Number.isFinite(shift) || shift < -100 || shift > 100) errors.push(`Ajustement de rendement invalide : ${regime.name} / ${id}.`);
    }
  }
  return errors;
}

/** Same historical annual vectors in ALL macro regimes for fair comparisons. */
export function generateProspectiveScenarios(
  input: ScenarioInput,
  historicalSettings: ScenarioSettings,
  settings: ProspectiveSettings,
): MacroScenarioResult {
  const diagnostics = validateProspectiveSettings(settings, input.assetIds);
  if (diagnostics.length) return { sets: [], diagnostics, clippedValues: 0 };
  const aligned = alignAnnualSeries(input.data, input.assetIds, input.start, input.end, input.mode);
  if (!aligned.ok) return { sets: [], diagnostics: aligned.diagnostics.map(d => d.message), clippedValues: 0 };
  const means = Object.fromEntries(input.assetIds.map(id => [
    id,
    aligned.years.reduce((sum, year) => sum + (returnValue(aligned.rowsByAsset[id].get(year)!, input.mode) ?? 0), 0) / aligned.years.length,
  ]));
  const generated = generateJointScenarios(input, { ...historicalSettings, scenarioCount: settings.pathsPerRegime });
  if (generated.diagnostics.length) return { sets: [], diagnostics: generated.diagnostics, clippedValues: 0 };

  const equityIds = input.assetIds.filter(id => equityExposure(id) >= 0.9);
  let clippedValues = 0;
  const sets = settings.regimes.map(regime => ({
    regime,
    scenarios: generated.scenarios.map(scenario => {
      const annualReturns = Object.fromEntries(input.assetIds.map(id => [id, [] as number[]])) as Record<string, number[]>;
      for (let year = 0; year < scenario.sourceYears.length; year++) {
        const commonEquityDeviation = equityIds.length
          ? equityIds.reduce((sum, id) => sum + scenario.annualReturns[id][year] - means[id], 0) / equityIds.length
          : 0;
        for (const id of input.assetIds) {
          const base = scenario.annualReturns[id][year];
          const shocked = means[id] + (regime.shiftsPct[id] ?? 0)
            + regime.volatilityMultiplier * (base - means[id])
            + regime.equityShockMultiplier * equityExposure(id) * commonEquityDeviation;
          // A long-only asset cannot lose more than 100% during one year.
          if (shocked < -100) clippedValues++;
          annualReturns[id].push(Math.max(-100, shocked));
        }
      }
      return { index: scenario.index, sourceYears: scenario.sourceYears, annualReturns };
    }),
  }));
  return { sets, diagnostics: [], clippedValues };
}
