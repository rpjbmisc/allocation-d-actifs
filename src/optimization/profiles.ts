/**
 * Dynamic optimization intents, not historical allocations.
 * These starting risk budgets are editable and are not investment recommendations.
 */
export type AllocationProfileId = "growth" | "controlled" | "robust" | "goal";

export interface AllocationRiskConstraints {
  maxAnnualCloseDrawdownPct: number | null;
  maxAnnualVolatilityPct: number | null;
  maxWeightPct: number;
}

export const DEFAULT_ALLOCATION_PROFILE: AllocationProfileId = "controlled";

export const allocationProfiles: Array<{
  id: AllocationProfileId;
  label: string;
  description: string;
  method: string;
}> = [
  {
    id: "growth",
    label: "Croissance maximale",
    description: "Maximise le TCAM historique sans plafond de risque initial. Les contraintes restent modifiables.",
    method: "Historique · sans budget de risque initial",
  },
  {
    id: "controlled",
    label: "Croissance maîtrisée",
    description: "Maximise le TCAM historique sous contraintes éditables de drawdown, volatilité et poids par actif.",
    method: "Historique · risque encadré",
  },
  {
    id: "robust",
    label: "Robustesse",
    description: "Privilégie les rendements défavorables simulés, ou les futurs hypothétiques choisis.",
    method: "Scénarios · quantile défavorable",
  },
  {
    id: "goal",
    label: "Objectif patrimonial",
    description: "Maximise la probabilité simulée d'atteindre le capital cible sur l'horizon choisi.",
    method: "Simulations · capital cible",
  },
];

export function defaultConstraintsForProfile(profile: AllocationProfileId): AllocationRiskConstraints {
  if (profile === "growth") return {
    maxAnnualCloseDrawdownPct: null,
    maxAnnualVolatilityPct: null,
    maxWeightPct: 100,
  };
  // Illustrative starting values; the investor can edit all three.
  return {
    maxAnnualCloseDrawdownPct: 40,
    maxAnnualVolatilityPct: 25,
    maxWeightPct: 50,
  };
}
