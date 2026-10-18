import type { Row, Mode } from "./types";
const aliases = {
  year: ["Year", "year"],
  price: ["Series_Level", "Index", "Price", "Gold_Price_USD", "Price_Index", "TR_Index", "TotalReturn_Index", "Total_Return_Index", "Gross_TR_Index", "GrossTR_Index_Start", "Close", "Value"],
  cpi: ["CPI", "CPI_U"],
  nominal: ["Annual_Return_Pct", "Evolution (percent)", "Nominal_Return", "Nominal_Return_Pct", "Total_Return", "Gross_Total_Return", "GrossTR_Return", "Total_Return_Nominal"],
  inflation: ["Inflation", "Inflation_Pct"],
  real: ["Real_Return", "Real_Return_Pct", "Real_Total_Return", "Real_Return_Gross", "Total_Return_Real"],
} as const;

const toNumber = (value: unknown): number => {
  if (value === null || value === undefined || value === "") return Number.NaN;
  if (typeof value === "boolean" || (typeof value === "string" && !value.trim())) return Number.NaN;
  const normalized = typeof value === "string" ? value.trim().replace(/\s/g, "").replace(",", ".") : value;
  const parsed = typeof normalized === "number" ? normalized : Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const pick = (row: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return null;
};

export function normalizeRows(raw: Record<string, unknown>[]): Row[] {
  return raw
    .map((row) => ({
      initialLevel: pick(row, aliases.nominal) === null || (typeof pick(row, aliases.nominal) === "string" && !String(pick(row, aliases.nominal)).trim()),
      year: toNumber(pick(row, aliases.year)),
      price: toNumber(pick(row, aliases.price)),
      cpi: toNumber(pick(row, aliases.cpi)),
      nominal: toNumber(pick(row, aliases.nominal)),
      inflation: toNumber(pick(row, aliases.inflation)),
      real: toNumber(pick(row, aliases.real)),
    }))
    .sort((a, b) => a.year - b.year)
    .map((row, index) => ({ ...row, initialLevel: index === 0 && row.initialLevel && Number.isNaN(row.nominal) && row.price > 0 && Number.isFinite(row.price) }));
}


export type DataIssue = { code: string; message: string; assetId?: string; year?: number };
export type AlignedSeries =
  | { ok: true; years: number[]; rowsByAsset: Record<string, Map<number, Row>>; diagnostics: [] }
  | { ok: false; diagnostics: DataIssue[] };

/** Annual observations, in percent. Only a genuine first level at start may lack a return.
 * No interpolation, zero filling, compressed gaps, or silent boundary truncation. */
export function alignAnnualSeries(data: Record<string, Row[]>, ids: string[], start: number, end: number, mode: Mode): AlignedSeries {
  const fail = (code: string, message: string, assetId?: string, year?: number): AlignedSeries =>
    ({ ok: false, diagnostics: [{ code, message, assetId, year }] });
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end - start > 10000 || !ids.length || new Set(ids).size !== ids.length)
    return fail("invalid_period", "Période ou sélection invalide.");
  const rowsByAsset: Record<string, Map<number, Row>> = {};
  let baseline = false;
  for (const id of ids) {
    const rows = data[id] ?? [];
    if (rows.some((r, i) => !Number.isInteger(r.year) || (i > 0 && r.year <= rows[i - 1].year)))
      return fail("invalid_years", "Années non triées, invalides ou dupliquées.", id);
    rowsByAsset[id] = new Map(rows.map(r => [r.year, r]));
    const first = rowsByAsset[id].get(start);
    if (first && Number.isNaN(first[mode]) && Number.isNaN(first.nominal) && first.initialLevel !== false && rows[0] === first && first.price > 0 && Number.isFinite(first.price)) baseline = true;
  }
  const firstYear = start + Number(baseline);
  if (firstYear > end) return fail("insufficient_history", "Aucun rendement annuel observé.");
  // Validate even the skipped baseline in every constituent.
  for (const id of ids) {
    const first = rowsByAsset[id].get(start);
    if (baseline && (!first || !(Number.isFinite(first[mode]) && first[mode] >= -100 ||
      Number.isNaN(first[mode]) && Number.isNaN(first.nominal) && first.initialLevel !== false && data[id][0] === first && first.price > 0 && Number.isFinite(first.price))))
      return fail("missing_return", "Niveau initial ou rendement manquant.", id, start);
  }
  const years = Array.from({ length: end - firstYear + 1 }, (_, i) => firstYear + i);
  for (const id of ids) for (const year of years) {
    const row = rowsByAsset[id].get(year);
    if (!row || !Number.isFinite(row[mode])) return fail("missing_return", "Rendement annuel manquant : historique incomplet.", id, year);
    if (row[mode] < -100) return fail("invalid_return", "Rendement inférieur à −100 %.", id, year);
  }
  return { ok: true, years, rowsByAsset, diagnostics: [] };
}

export function assetCoversPeriod(rows: Row[] | undefined, start: number, end: number, mode: Mode = "nominal"): boolean {
  return alignAnnualSeries({ asset: rows ?? [] }, ["asset"], start, end, mode).ok;
}

export function dataBounds(rows: Row[] | undefined, fallback: [number, number]): [number, number] {
  const years = rows?.map(row => row.year).filter(Number.isFinite) ?? [];
  return years.length ? [Math.min(...years), Math.max(...years)] : fallback;
}

/** Audit source data without changing observations or inferring missing returns from levels. */
export function auditRows(rows: Row[], bounds?: { startYear: number; endYear: number }): DataIssue[] {
  const issues: DataIssue[] = [];
  if (!rows.length) return [{ code: "empty_series", message: "Série vide." }];
  rows.forEach((row, i) => {
    if (!Number.isInteger(row.year) || (i > 0 && row.year !== rows[i - 1].year + 1))
      issues.push({ code: "invalid_years", message: "Années invalides, dupliquées ou discontinues.", year: row.year });
    if (!Number.isFinite(row.price) || row.price <= 0)
      issues.push({ code: "invalid_level", message: "Niveau de série absent ou non positif.", year: row.year });
    if (!(Number.isFinite(row.nominal) && row.nominal >= -100) && !(i === 0 && row.initialLevel !== false && Number.isNaN(row.nominal)))
      issues.push({ code: "invalid_return", message: "Rendement absent ou invalide.", year: row.year });
  });
  if (bounds && (rows[0].year !== bounds.startYear || rows.at(-1)!.year !== bounds.endYear))
    issues.push({ code: "metadata_mismatch", message: "Bornes du registre différentes des observations." });
  return issues;
}
