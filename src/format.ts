export const formatPercent = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "n.d."
    : `${value > 0 ? "+" : ""}${value.toFixed(digits)} %`;

export const formatNumber = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "n.d."
    : value.toLocaleString("fr-FR", { maximumFractionDigits: digits });

export const formatMoney = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M$`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} k$`;
  return `${value.toFixed(0)} $`;
};
