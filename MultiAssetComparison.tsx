import { useEffect, useState, useCallback, Fragment } from "react";
import { useFile } from "@dust/react-hooks";
import Papa from "papaparse";
import {
  LineChart, Line, BarChart, Bar,
  CartesianGrid, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "shadcn";
import { BarChart2, TrendingUp, TrendingDown } from "lucide-react";

interface AssetEntry {
  id: string;
  name: string;
  csvFile: string;
  accentColor: string;
  headingClass: string;
  kpiNomClass: string;
  startYear: number;
  endYear: number;
}

interface Row {
  Year: number;
  Price: number;
  CPI: number;
  Nominal_Return: number;
  Inflation: number;
  Real_Return: number;
}

type Mode = "nominal" | "real";

// Rendement selon le mode courant
const getRet = (r: Row, mode: Mode): number | null => {
  const v = mode === "nominal" ? r.Nominal_Return : r.Real_Return;
  return v == null || isNaN(v) ? null : v;
};

// ── Normalisation des colonnes CSV ──
// Certains CSV utilisent des noms de colonnes différents (ex : l'or emploie
// Gold_Price_USD / CPI_U / Nominal_Return_Pct…). On mappe tous les alias connus
// vers le schéma standard pour que chaque actif s'affiche correctement.
const numOrNaN = (v: unknown): number => {
  if (v == null || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(v);
  return isNaN(n) ? NaN : n;
};

const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return null;
};

function normalizeRows(raw: Record<string, unknown>[]): Row[] {
  return raw
    .map((r) => ({
      Year: numOrNaN(pick(r, ["Year", "year"])),
      Price: numOrNaN(pick(r, ["Price", "Gold_Price_USD", "Price_Index", "TR_Index", "Close", "Value"])),
      CPI: numOrNaN(pick(r, ["CPI", "CPI_U"])),
      Nominal_Return: numOrNaN(pick(r, ["Nominal_Return", "Nominal_Return_Pct", "Total_Return"])),
      Inflation: numOrNaN(pick(r, ["Inflation", "Inflation_Pct"])),
      Real_Return: numOrNaN(pick(r, ["Real_Return", "Real_Return_Pct", "Real_Total_Return"])),
    }))
    .filter((r) => !isNaN(r.Year));
}

// Invisible loader: renders null, calls useFile at top level (valid hook usage)
function AssetLoader({
  asset,
  onLoad,
}: {
  asset: AssetEntry;
  onLoad: (id: string, rows: Row[]) => void;
}) {
  const file = useFile(`pod-vlt_VZXFmABLU4zDq/${asset.csvFile}`);
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await file.text();
        const parsed = Papa.parse<Record<string, unknown>>(text, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: "greedy",
        });
        const rows = normalizeRows(parsed.data);
        if (!cancelled && rows.length > 0) onLoad(asset.id, rows);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [file]);
  return null;
}

function geoMean(values: number[]): number {
  if (values.length === 0) return 0;
  return (Math.pow(values.reduce((a, b) => a * (1 + b / 100), 1), 1 / values.length) - 1) * 100;
}

function cagr(startP: number, endP: number, years: number): number | null {
  if (startP <= 0 || endP <= 0 || years <= 0) return null;
  return ((endP / startP) ** (1 / years) - 1) * 100;
}

function computeStats(rows: Row[], s: number, e: number, mode: Mode) {
  const filtered = rows.filter(
    (r) => r.Year >= s && r.Year <= e && getRet(r, mode) != null
  );
  if (filtered.length === 0) return null;
  const nomVals = rows
    .filter((r) => r.Year >= s && r.Year <= e && r.Nominal_Return != null && !isNaN(r.Nominal_Return))
    .map((r) => r.Nominal_Return);
  const realVals = rows
    .filter((r) => r.Year >= s && r.Year <= e && r.Real_Return != null && !isNaN(r.Real_Return))
    .map((r) => r.Real_Return);
  const vals = filtered.map((r) => getRet(r, mode) as number);
  const best = filtered.reduce((b, r) => ((getRet(r, mode) as number) > (getRet(b, mode) as number) ? r : b));
  const worst = filtered.reduce((b, r) => ((getRet(r, mode) as number) < (getRet(b, mode) as number) ? r : b));
  const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length;
  const variance = vals.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / vals.length;
  const positiveYears = vals.filter((v) => v > 0).length;
  const sorted = [...filtered].sort((a, b) => (getRet(b, mode) as number) - (getRet(a, mode) as number));
  return {
    tcamNom: nomVals.length > 0 ? geoMean(nomVals) : null,
    tcamReal: realVals.length > 0 ? geoMean(realVals) : null,
    best,
    worst,
    best5: sorted.slice(0, 5),
    worst5: sorted.slice(-5).reverse(),
    volatility: Math.sqrt(variance),
    count: filtered.length,
    positiveRate: (positiveYears / filtered.length) * 100,
  };
}

const fmt = (v: number | null | undefined, d = 1) =>
  v == null || isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
const fmtPos = (v: number | null | undefined, d = 1) =>
  v == null || isNaN(v) ? "—" : `${v.toFixed(d)}%`;
const fmtPrice = (v: number | null | undefined) =>
  v == null || isNaN(v)
    ? "—"
    : v.toLocaleString("fr-FR", { maximumFractionDigits: v >= 100 ? 0 : 2 });

// Grandes phases macro-historiques (filtrées ensuite selon la période commune)
const GLOBAL_PERIODS: { name: string; start: number; end: number; color: string }[] = [
  { name: "Grande Dépression", start: 1929, end: 1939, color: "#6366f1" },
  { name: "Boom d'après-guerre", start: 1946, end: 1965, color: "#0ea5e9" },
  { name: "Stagflation", start: 1970, end: 1979, color: "#8b5cf6" },
  { name: "Désinflation & bull 80-90s", start: 1980, end: 1999, color: "#ef4444" },
  { name: "Bulle Internet & krach", start: 2000, end: 2002, color: "#f59e0b" },
  { name: "Reprise mid-2000s", start: 2003, end: 2007, color: "#22c55e" },
  { name: "Crise financière (GFC)", start: 2008, end: 2009, color: "#dc2626" },
  { name: "Reprise post-GFC", start: 2010, end: 2019, color: "#14b8a6" },
  { name: "Covid & post-Covid", start: 2020, end: 2025, color: "#a855f7" },
];

type Tab = "kpi" | "price" | "annual" | "cumulative" | "decades";

export default function MultiAssetComparison() {
  const indexFile = useFile("pod-vlt_VZXFmABLU4zDq/assets_index.json");
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [loadedData, setLoadedData] = useState<Record<string, Row[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [indexStatus, setIndexStatus] = useState<"loading" | "ok" | "error">("loading");
  const [activeTab, setActiveTab] = useState<Tab>("kpi");
  const [mode, setMode] = useState<Mode>("nominal");
  const [yearRange, setYearRange] = useState<[number, number]>([1970, 2025]);
  const [useCommonPeriod, setUseCommonPeriod] = useState(true);

  useEffect(() => {
    if (!indexFile) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await indexFile.text();
        const parsed: AssetEntry[] = JSON.parse(text);
        if (!cancelled) {
          setAssets(parsed);
          setSelected([parsed[0]?.id, parsed[1]?.id].filter(Boolean));
          setIndexStatus("ok");
        }
      } catch {
        if (!cancelled) setIndexStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [indexFile]);

  const handleDataLoaded = useCallback((id: string, rows: Row[]) => {
    setLoadedData((prev) => ({ ...prev, [id]: rows }));
  }, []);

  const toggleAsset = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.length > 1 ? prev.filter((x) => x !== id) : prev;
      return prev.length < 4 ? [...prev, id] : prev;
    });
  };

  const selectedAssets = assets.filter((a) => selected.includes(a.id));
  const selectedWithData = selectedAssets.filter((a) => loadedData[a.id]);
  const loadingCount = selectedAssets.length - selectedWithData.length;

  const commonStart =
    selectedWithData.length > 0
      ? Math.max(...selectedWithData.map((a) => Math.min(...loadedData[a.id].map((r) => r.Year))))
      : yearRange[0];
  const commonEnd =
    selectedWithData.length > 0
      ? Math.min(...selectedWithData.map((a) => Math.max(...loadedData[a.id].map((r) => r.Year))))
      : yearRange[1];

  const effRange: [number, number] = useCommonPeriod ? [commonStart, commonEnd] : yearRange;

  const modeLabel = mode === "nominal" ? "nominal" : "réel";

  // Annual returns chart data (mode-aware)
  const annualData = (() => {
    const yearSet = new Set<number>();
    selectedWithData.forEach((a) =>
      loadedData[a.id].forEach((r) => {
        if (r.Year >= effRange[0] && r.Year <= effRange[1]) yearSet.add(r.Year);
      })
    );
    return Array.from(yearSet)
      .sort((x, y) => x - y)
      .map((year) => {
        const pt: Record<string, unknown> = { year };
        selectedWithData.forEach((a) => {
          const row = loadedData[a.id].find((r) => r.Year === year);
          pt[a.id] = row ? getRet(row, mode) : null;
        });
        return pt;
      });
  })();

  // Price chart data (mode-aware: real price rebased to latest CPI)
  const priceData = (() => {
    const yearSet = new Set<number>();
    const lastCpi: Record<string, number> = {};
    selectedWithData.forEach((a) => {
      const inRange = loadedData[a.id].filter((r) => r.Year >= effRange[0] && r.Year <= effRange[1]);
      inRange.forEach((r) => yearSet.add(r.Year));
      const withCpi = inRange.filter((r) => r.CPI != null && !isNaN(r.CPI));
      lastCpi[a.id] = withCpi.length > 0 ? withCpi[withCpi.length - 1].CPI : 100;
    });
    return Array.from(yearSet)
      .sort((x, y) => x - y)
      .map((year) => {
        const pt: Record<string, unknown> = { year };
        selectedWithData.forEach((a) => {
          const row = loadedData[a.id].find((r) => r.Year === year);
          if (row && row.Price != null && !isNaN(row.Price)) {
            if (mode === "real" && row.CPI != null && !isNaN(row.CPI) && row.CPI > 0) {
              pt[a.id] = Math.round((row.Price / row.CPI) * lastCpi[a.id] * 100) / 100;
            } else {
              pt[a.id] = row.Price;
            }
          } else {
            pt[a.id] = null;
          }
        });
        return pt;
      });
  })();

  // Cumulative growth data (mode-aware)
  const cumulativeData = (() => {
    const yearSet = new Set<number>();
    selectedWithData.forEach((a) =>
      loadedData[a.id].forEach((r) => {
        if (r.Year >= effRange[0] && r.Year <= effRange[1]) yearSet.add(r.Year);
      })
    );
    const sortedYears = Array.from(yearSet).sort((x, y) => x - y);
    const values: Record<string, number> = {};
    selectedWithData.forEach((a) => { values[a.id] = 100; });

    const base: Record<string, unknown> = { year: effRange[0] - 1 };
    selectedWithData.forEach((a) => { base[a.id] = 100; });

    const points = sortedYears.map((year) => {
      const pt: Record<string, unknown> = { year };
      selectedWithData.forEach((a) => {
        const row = loadedData[a.id].find((r) => r.Year === year);
        const ret = row ? getRet(row, mode) : null;
        if (ret != null) {
          values[a.id] = values[a.id] * (1 + ret / 100);
          pt[a.id] = Math.round(values[a.id] * 10) / 10;
        } else {
          pt[a.id] = null;
        }
      });
      return pt;
    });
    return [base, ...points];
  })();

  // Decade chart data (mode-aware)
  const decadeData = (() => {
    const decMap: Record<number, Record<string, number[]>> = {};
    selectedWithData.forEach((a) => {
      loadedData[a.id]
        .filter((r) => r.Year >= effRange[0] && r.Year <= effRange[1] && getRet(r, mode) != null)
        .forEach((r) => {
          const d = Math.floor(r.Year / 10) * 10;
          if (!decMap[d]) decMap[d] = {};
          if (!decMap[d][a.id]) decMap[d][a.id] = [];
          decMap[d][a.id].push(getRet(r, mode) as number);
        });
    });
    return Object.entries(decMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([dec, data]) => {
        const pt: Record<string, unknown> = { decade: `${dec}s` };
        selectedWithData.forEach((a) => {
          const vals = data[a.id] || [];
          if (vals.length > 0) pt[a.id] = Math.round(geoMean(vals) * 10) / 10;
        });
        return pt;
      });
  })();

  const statsMap = Object.fromEntries(
    selectedWithData.map((a) => [a.id, computeStats(loadedData[a.id], effRange[0], effRange[1], mode)])
  );

  // Périodes historiques entièrement contenues dans la période effective
  const visiblePeriods = GLOBAL_PERIODS.filter(
    (p) => p.start >= effRange[0] && p.end <= effRange[1]
  );

  const tabBtn = (tab: Tab, label: string) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
        activeTab === tab ? "text-white" : "text-gray-600 hover:bg-gray-100"
      }`}
      style={activeTab === tab ? { backgroundColor: "#1e293b" } : {}}
    >
      {label}
    </button>
  );

  const tooltipFormatter = (value: number, name: string) => {
    const asset = assets.find((a) => a.id === name);
    return [`${value != null ? value.toFixed(1) : "—"}%`, asset?.name || name];
  };

  const legendFormatter = (value: string) => assets.find((a) => a.id === value)?.name || value;

  const duration = effRange[1] - effRange[0] + 1;

  return (
    <div className="min-h-screen bg-background px-4 py-6">
      {/* Background loaders for ALL assets */}
      {assets.map((asset) => (
        <AssetLoader key={asset.id} asset={asset} onLoad={handleDataLoaded} />
      ))}

      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Comparaison multi-actifs</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Sélectionnez jusqu'à 4 classes d'actifs et comparez leurs rendements historiques
          </p>
        </div>

        {/* Index states */}
        {indexStatus === "loading" && (
          <div className="h-10 rounded-xl bg-muted animate-pulse" />
        )}
        {indexStatus === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Impossible de charger le registre des actifs (assets_index.json).
          </div>
        )}

        {/* Asset selector */}
        {indexStatus === "ok" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {assets.map((asset) => {
                const isSel = selected.includes(asset.id);
                const isLoaded = !!loadedData[asset.id];
                const isDisabled = !isSel && selected.length >= 4;
                return (
                  <button
                    key={asset.id}
                    onClick={() => toggleAsset(asset.id)}
                    disabled={isDisabled}
                    style={{
                      backgroundColor: isSel ? asset.accentColor : "transparent",
                      borderColor: asset.accentColor,
                      color: isSel ? "white" : asset.accentColor,
                      opacity: isDisabled ? 0.35 : 1,
                    }}
                    className="px-3 py-1.5 rounded-full text-sm font-semibold border-2 transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSel && !isLoaded && (
                      <span className="w-2 h-2 rounded-full bg-white opacity-70 animate-pulse inline-block" />
                    )}
                    {asset.name}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selected.length}/4 actifs sélectionnés
              {selected.length >= 4 && " — désélectionnez-en un pour en ajouter un autre"}
            </p>
          </div>
        )}

        {/* Period + mode controls */}
        {selectedWithData.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 bg-gray-50 rounded-xl px-4 py-3 text-sm">
            <label className="flex items-center gap-2 text-gray-700 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={useCommonPeriod}
                onChange={(e) => setUseCommonPeriod(e.target.checked)}
                className="rounded"
              />
              Période commune ({commonStart}–{commonEnd})
            </label>
            {!useCommonPeriod && (
              <div className="flex items-center gap-2 text-gray-700">
                <span>De</span>
                <input
                  type="number"
                  value={yearRange[0]}
                  min={1920}
                  max={yearRange[1] - 1}
                  onChange={(e) => setYearRange([Number(e.target.value), yearRange[1]])}
                  className="w-20 border rounded px-2 py-1"
                />
                <span>à</span>
                <input
                  type="number"
                  value={yearRange[1]}
                  min={yearRange[0] + 1}
                  max={2025}
                  onChange={(e) => setYearRange([yearRange[0], Number(e.target.value)])}
                  className="w-20 border rounded px-2 py-1"
                />
              </div>
            )}

            {/* Nominal / Réel toggle */}
            <div className="flex rounded-lg border bg-card p-1 gap-1">
              <button
                onClick={() => setMode("nominal")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  mode === "nominal" ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Nominal
              </button>
              <button
                onClick={() => setMode("real")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  mode === "real" ? "bg-gray-800 text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                Réel
              </button>
            </div>

            <span className="text-muted-foreground ml-auto text-xs">
              {duration} an{duration > 1 ? "s" : ""} · {modeLabel}
            </span>
          </div>
        )}

        {/* Loading indicator */}
        {loadingCount > 0 && (
          <p className="text-sm text-muted-foreground animate-pulse">
            Chargement des données ({selectedWithData.length}/{selectedAssets.length})…
          </p>
        )}

        {/* Tabs */}
        {selectedWithData.length > 0 && (
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
            {tabBtn("kpi", "KPIs")}
            {tabBtn("price", "Prix")}
            {tabBtn("annual", "Rendements annuels")}
            {tabBtn("cumulative", "Croissance cumulée")}
            {tabBtn("decades", "Par décennie")}
          </div>
        )}

        {/* ── KPI TAB ── */}
        {activeTab === "kpi" && selectedWithData.length > 0 && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}
          >
            {selectedWithData.map((asset) => {
              const s = statsMap[asset.id];
              if (!s) return null;
              return (
                <Card key={asset.id} className="overflow-hidden">
                  <div className="h-2 w-full" style={{ backgroundColor: asset.accentColor }} />
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-base font-bold" style={{ color: asset.accentColor }}>
                      {asset.name}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {effRange[0]}–{effRange[1]} · {s.count} ans
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-xs text-muted-foreground">TCAM nominal</p>
                        <p
                          className="text-xl font-bold"
                          style={{ color: mode === "nominal" ? asset.accentColor : "#6b7280" }}
                        >
                          {fmt(s.tcamNom)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-xs text-muted-foreground">TCAM réel</p>
                        <p
                          className="text-xl font-bold"
                          style={{ color: mode === "real" ? asset.accentColor : "#6b7280" }}
                        >
                          {fmt(s.tcamReal)}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-green-50 p-2">
                        <p className="text-xs text-muted-foreground">Meilleure année ({modeLabel})</p>
                        <p className="text-sm font-bold text-green-700">{fmt(getRet(s.best, mode))}</p>
                        <p className="text-xs text-green-600">{s.best?.Year}</p>
                      </div>
                      <div className="rounded-lg bg-red-50 p-2">
                        <p className="text-xs text-muted-foreground">Pire année ({modeLabel})</p>
                        <p className="text-sm font-bold text-red-700">{fmt(getRet(s.worst, mode))}</p>
                        <p className="text-xs text-red-600">{s.worst?.Year}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-xs text-muted-foreground">Volatilité ({modeLabel})</p>
                        <p className="text-sm font-bold text-gray-700">{fmtPos(s.volatility)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-xs text-muted-foreground">Années positives</p>
                        <p className="text-sm font-bold text-gray-700">{fmtPos(s.positiveRate, 0)}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── PRICE TAB ── */}
        {activeTab === "price" && selectedWithData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-800">
                Évolution du prix {mode === "real" ? "(ajusté inflation)" : "(nominal)"} — {effRange[0]}–{effRange[1]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={priceData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    scale="log"
                    domain={["auto", "auto"]}
                    allowDataOverflow
                    tickFormatter={(v) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                    }
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const asset = assets.find((a) => a.id === name);
                      return [fmtPrice(value), asset?.name || name];
                    }}
                    labelFormatter={(l) => `${l}`}
                  />
                  <Legend formatter={legendFormatter} />
                  {selectedWithData.map((a) => (
                    <Line
                      key={a.id}
                      type="monotone"
                      dataKey={a.id}
                      stroke={a.accentColor}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Échelle logarithmique — niveaux de prix bruts (unités propres à chaque actif : points d'indice, $/oz, $…). Pour une base 100 comparable, voir l'onglet « Croissance cumulée ».
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── ANNUAL RETURNS TAB ── */}
        {activeTab === "annual" && selectedWithData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-800">
                Rendements annuels {modeLabel}s — {effRange[0]}–{effRange[1]}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={380}>
                <BarChart data={annualData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip formatter={tooltipFormatter} labelFormatter={(l) => `${l}`} />
                  <Legend formatter={legendFormatter} />
                  <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
                  {selectedWithData.map((a) => (
                    <Bar key={a.id} dataKey={a.id} fill={a.accentColor} opacity={0.85} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ── CUMULATIVE TAB ── */}
        {activeTab === "cumulative" && selectedWithData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-800">
                Croissance de 100 $ investis en {effRange[0]} ({modeLabel})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={cumulativeData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="year"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    scale="log"
                    domain={["auto", "auto"]}
                    tickFormatter={(v) =>
                      v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                    }
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const asset = assets.find((a) => a.id === name);
                      return [
                        value >= 1000000
                          ? `$${(value / 1000000).toFixed(2)}M`
                          : value >= 1000
                          ? `$${(value / 1000).toFixed(1)}k`
                          : `$${value?.toFixed(0)}`,
                        asset?.name || name,
                      ];
                    }}
                    labelFormatter={(l) => `${l}`}
                  />
                  <Legend formatter={legendFormatter} />
                  {selectedWithData.map((a) => (
                    <Line
                      key={a.id}
                      type="monotone"
                      dataKey={a.id}
                      stroke={a.accentColor}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Échelle logarithmique — rendements {modeLabel}s, dividendes réinvestis
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── DECADES TAB ── */}
        {activeTab === "decades" && selectedWithData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-800">
                TCAM moyen par décennie ({modeLabel})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={decadeData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="decade" tick={{ fontSize: 12, fill: "#6b7280" }} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip formatter={tooltipFormatter} />
                  <Legend formatter={legendFormatter} />
                  <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
                  {selectedWithData.map((a) => (
                    <Bar key={a.id} dataKey={a.id} fill={a.accentColor} opacity={0.85} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ── TOP 5 BEST / WORST YEARS (multi-actifs) ── */}
        {selectedWithData.length > 0 && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
            {/* Best */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  Top 5 meilleures années ({modeLabel})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-3 font-medium text-muted-foreground">#</th>
                        {selectedWithData.map((a) => (
                          <th key={a.id} colSpan={2} className="pb-2 pr-3 font-semibold text-center" style={{ color: a.accentColor }}>
                            {a.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                          {selectedWithData.map((a) => {
                            const d = statsMap[a.id]?.best5[i];
                            return (
                              <Fragment key={a.id}>
                                <td className="py-2 pr-2 text-right tabular-nums">{d ? d.Year : "—"}</td>
                                <td className="py-2 pr-3 text-right font-semibold text-emerald-600 tabular-nums">
                                  {d ? fmt(getRet(d, mode)) : "—"}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Worst */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-rose-600" />
                  Top 5 pires années ({modeLabel})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-3 font-medium text-muted-foreground">#</th>
                        {selectedWithData.map((a) => (
                          <th key={a.id} colSpan={2} className="pb-2 pr-3 font-semibold text-center" style={{ color: a.accentColor }}>
                            {a.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                          {selectedWithData.map((a) => {
                            const d = statsMap[a.id]?.worst5[i];
                            return (
                              <Fragment key={a.id}>
                                <td className="py-2 pr-2 text-right tabular-nums">{d ? d.Year : "—"}</td>
                                <td className="py-2 pr-3 text-right font-semibold text-rose-600 tabular-nums">
                                  {d ? fmt(getRet(d, mode)) : "—"}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── HISTORICAL KEY PERIODS (restricted to common range) ── */}
        {selectedWithData.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Périodes historiques clés — TCAM {modeLabel}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Uniquement les phases entièrement comprises dans la période {effRange[0]}–{effRange[1]}
              </p>
            </CardHeader>
            <CardContent>
              {visiblePeriods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune phase historique de référence n'est entièrement contenue dans la période commune sélectionnée.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-3 font-medium">Période</th>
                        <th className="pb-2 pr-3 font-medium">Années</th>
                        {selectedWithData.map((a) => (
                          <th key={a.id} className="pb-2 pr-3 font-semibold text-right" style={{ color: a.accentColor }}>
                            {a.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePeriods.map((pr) => (
                        <tr key={pr.name} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-medium" style={{ color: pr.color }}>
                            {pr.name}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                            {pr.start}–{pr.end}
                          </td>
                          {selectedWithData.map((a) => {
                            const rows = loadedData[a.id];
                            const sRow =
                              rows.find((r) => r.Year === pr.start - 1 && r.Price != null && !isNaN(r.Price)) ||
                              rows.find((r) => r.Year === pr.start && r.Price != null && !isNaN(r.Price));
                            const eRow = rows.find((r) => r.Year === pr.end && r.Price != null && !isNaN(r.Price));
                            let c: number | null = null;
                            if (sRow && eRow) {
                              const yrs = pr.end - sRow.Year;
                              if (mode === "real" && sRow.CPI && eRow.CPI) {
                                c = cagr(sRow.Price / sRow.CPI, eRow.Price / eRow.CPI, yrs);
                              } else {
                                c = cagr(sRow.Price, eRow.Price, yrs);
                              }
                            }
                            return (
                              <td
                                key={a.id}
                                className="py-2 pr-3 text-right font-medium tabular-nums"
                                style={{ color: c == null ? "#9ca3af" : c >= 0 ? "#16a34a" : "#dc2626" }}
                              >
                                {c == null ? "—" : fmt(c)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {selectedWithData.length === 0 && indexStatus === "ok" && loadingCount === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <BarChart2 className="w-12 h-12 mb-4 opacity-25" />
            <p className="text-sm">Sélectionnez au moins un actif pour afficher les données.</p>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground pb-4">
          Sources : Federal Reserve, MSCI, FTSE NAREIT, Bloomberg, CoinGecko — rendements en USD
        </p>
      </div>
    </div>
  );
}
