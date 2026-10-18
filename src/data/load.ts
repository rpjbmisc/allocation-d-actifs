import Papa from "papaparse";
import type { Asset, CurrencyContext, Row } from "../domain/types";
import { normalizeRows, auditRows } from "../domain/data";

type FetchData = (url: string) => Promise<Response>;
export interface LoadedData<T> { assets: Asset[]; presets: T[]; rawData: Record<string, Row[]>; currencyContext: CurrencyContext }

/** Network boundary only; financial calculations never fetch. Missing files fail explicitly. */
export async function loadHistoricalData<T>(base: string, fetchData: FetchData = fetch): Promise<LoadedData<T>> {
  const response = async (file: string) => {
    const result = await fetchData(`${base}data/${encodeURIComponent(file)}`);
    if (!result.ok) throw new Error(`Données introuvables : ${file} (${result.status}).`);
    return result;
  };
  const parse = (csv: string) => {
    const result = Papa.parse<Record<string, unknown>>(csv, { header: true, dynamicTyping: true, skipEmptyLines: true });
    if (result.errors.length) throw new Error(`CSV invalide : ${result.errors[0].message}`);
    return result.data;
  };
  const [indexResponse, presetsResponse, fxResponse, cpiResponse] = await Promise.all([
    response("assets_index.json"), response("candidate_presets.json"),
    response("fx_usd_per_eur_historical_1960_2025.csv"), response("french_cpi_dec_dec_1960_2025.csv"),
  ]);
  const assets = await indexResponse.json() as Asset[];
  if (!Array.isArray(assets) || !assets.length || new Set(assets.map(a => a.id)).size !== assets.length)
    throw new Error("Registre des actifs invalide.");
  const presets = await presetsResponse.json() as T[];
  const annual = (csv: string, key: string) => {
    const values: Record<number, number> = {};
    for (const row of parse(csv)) {
      const year = row.Year, value = row[key];
      if (typeof year !== "number" || !Number.isInteger(year) || typeof value !== "number" || !Number.isFinite(value) || year in values)
        throw new Error(`Série annuelle invalide : ${key}.`);
      values[year] = value;
    }
    return values;
  };
  const rawData = Object.fromEntries(await Promise.all(assets.map(async asset => {
    const rows = normalizeRows(parse(await (await response(asset.csvFile)).text()));
    const issues = auditRows(rows, asset);
    if (issues.length) throw new Error(`${asset.name} : ${issues[0].message}`);
    return [asset.id, rows];
  })));
  return { assets, presets, rawData, currencyContext: {
    usdPerEur: annual(await fxResponse.text(), "USD_per_EUR"),
    frenchInflation: annual(await cpiResponse.text(), "Inflation_Dec_Dec_Pct"),
  } };
}
