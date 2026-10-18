/** Inputs are UI percentages; normalized engine weights are fractions summing to one.
 * Manual sliders retain their historical proportional normalization, explicitly. */
export function normalizeWeights(weights: Record<string, number>): Record<string, number> | null {
  const entries = Object.entries(weights);
  if (!entries.length || entries.some(([, w]) => !Number.isFinite(w) || w < 0)) return null;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  if (!(total > 0) || !Number.isFinite(total)) return null;
  return Object.fromEntries(entries.map(([id, w]) => [id, w / total]));
}

export function validateWeights(weights: Record<string, number>, maxWeightByAsset: Record<string, number> = {}): string[] {
  const issues: string[] = [];
  if (!Object.keys(weights).length || Object.values(weights).some(w => !Number.isFinite(w) || w < 0)) issues.push("Poids non finis ou négatifs.");
  if (Math.abs(Object.values(weights).reduce((sum, w) => sum + w, 0) - 1) > 1e-10) issues.push("La somme des poids doit être égale à 1.");
  for (const [id, cap] of Object.entries(maxWeightByAsset)) {
    if (!Number.isFinite(cap) || cap < 0 || cap > 1 || (weights[id] ?? 0) > cap + 1e-10) issues.push(`Plafond invalide ou dépassé : ${id}.`);
  }
  return issues;
}
