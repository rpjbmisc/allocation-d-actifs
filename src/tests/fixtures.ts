import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { normalizeRows, localizeRows } from "../analytics";
import type { Asset, Currency, Row, CurrencyContext } from "../analytics";

export const rows = (returns: number[], start = 2000): Row[] => returns.map((r, i) => ({ year: start + i, price: 100, nominal: r, real: r, cpi: Number.NaN, inflation: 0 }));
export const read = (file: string) => Papa.parse<Record<string, unknown>>(fs.readFileSync(path.resolve("public/data", file), "utf8"), { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
export const assets = JSON.parse(fs.readFileSync("public/data/assets_index.json", "utf8")) as Asset[];
export const context: CurrencyContext = {
  usdPerEur: Object.fromEntries(read("fx_usd_per_eur_historical_1960_2025.csv").map(r => [r.Year, r.USD_per_EUR])),
  frenchInflation: Object.fromEntries(read("french_cpi_dec_dec_1960_2025.csv").map(r => [r.Year, r.Inflation_Dec_Dec_Pct])),
};
export const historicalData = (currency: Currency) => Object.fromEntries(assets.map(a => [a.id, localizeRows(normalizeRows(read(a.csvFile)), currency, context)]));
