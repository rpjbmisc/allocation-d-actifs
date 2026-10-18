import type { Row, Mode, Currency, CurrencyContext } from "./types";
export function localizeRows(rows: Row[], currency: Currency, context: CurrencyContext): Row[] {
  return rows
    .filter((row) => currency === "usd" || row.year >= 1961)
    .map((row) => {
      const fxReturn = currency === "eur" ? currencyFxReturn(context, row.year) : 0;
      if (!Number.isFinite(row.nominal) || row.nominal < -100 || fxReturn === null) {
        return { ...row, initialLevel: row.initialLevel ?? Number.isNaN(row.nominal), nominal: Number.NaN, real: Number.NaN };
      }

      const nominal = (1 + row.nominal / 100) * (1 + fxReturn / 100) * 100 - 100;
      const inflation = context.frenchInflation[row.year];
      const real = Number.isFinite(inflation) && inflation > -100
        ? ((1 + nominal / 100) / (1 + inflation / 100) - 1) * 100
        : Number.NaN;
      return { ...row, nominal, inflation, real };
    });
}

export function returnValue(row: Row, mode: Mode): number | null {
  const value = mode === "nominal" ? row.nominal : row.real;
  return Number.isFinite(value) && value >= -100 ? value : null;
}


/** Annual uncovered exchange effect, in percentage points; FX quotes USD per EUR. */
export function currencyFxReturn(context: CurrencyContext, year: number): number | null {
  const current = context.usdPerEur[year], previous = context.usdPerEur[year - 1];
  return Number.isFinite(current) && Number.isFinite(previous) && current > 0 && previous > 0
    ? (previous / current - 1) * 100 : null;
}
