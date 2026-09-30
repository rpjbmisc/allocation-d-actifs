import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, CircleHelp, Download, SlidersHorizontal } from "lucide-react";
import {
  Asset,
  computeStats,
  computePortfolio,
  computeCorrelationDetails,
  computeCorrelationMatrix,
  formatMoney,
  formatNumber,
  formatPercent,
  Mode,
  normalizeRows,
  PortfolioStats,
  returnValue,
  Row,
} from "./analytics";

type Tab = "overview" | "price" | "returns" | "growth" | "decades" | "portfolio" | "correlations";
type Dataset = Record<string, Row[]>;
type PresetId = "custom" | "pure" | "constrained" | "robust" | "bitcoin";

interface CandidatePreset {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
  weights: Record<string, number>;
  start: number;
  end: number;
}

const fallbackAssets: Asset[] = [];
const historicalPhases = [
  { name: "Grande Dépression", start: 1929, end: 1939, color: "#6d5ce7" },
  { name: "Boom d'après-guerre", start: 1946, end: 1965, color: "#2a9d8f" },
  { name: "Stagflation", start: 1970, end: 1979, color: "#e9a23b" },
  { name: "Désinflation & bull 80-90s", start: 1980, end: 1999, color: "#e76f51" },
  { name: "Bulle Internet", start: 2000, end: 2002, color: "#d1495b" },
  { name: "Crise financière", start: 2008, end: 2009, color: "#9b2226" },
  { name: "Reprise post-GFC", start: 2010, end: 2019, color: "#2a9d8f" },
  { name: "Covid & post-Covid", start: 2020, end: 2025, color: "#457b9d" },
];

const chartTabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "price", label: "Niveaux" },
  { id: "returns", label: "Rendements" },
  { id: "growth", label: "100 $ investis" },
  { id: "decades", label: "Décennies" },
];

const dataUrl = (file: string) => `/data/${encodeURIComponent(file)}`;

function App() {
  const isCorrelationPage = window.location.pathname.replace(/\/+$/, "") === "/correlations";
  const [assets, setAssets] = useState<Asset[]>(fallbackAssets);
  const [data, setData] = useState<Dataset>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("nominal");
  const [range, setRange] = useState<[number, number]>([1970, 2025]);
  const [commonPeriod, setCommonPeriod] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [activePreset, setActivePreset] = useState<PresetId>("custom");
  const [presetDefinitions, setPresetDefinitions] = useState<CandidatePreset[]>([]);
  const [presetModified, setPresetModified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [indexResponse, presetsResponse] = await Promise.all([
          fetch("/data/assets_index.json"),
          fetch("/data/candidate_presets.json"),
        ]);
        if (!indexResponse.ok) throw new Error("Le registre des actifs est introuvable.");
        if (!presetsResponse.ok) throw new Error("Les allocations candidates sont introuvables.");
        const [registry, presets] = await Promise.all([
          indexResponse.json() as Promise<Asset[]>,
          presetsResponse.json() as Promise<CandidatePreset[]>,
        ]);
        const loaded = await Promise.all(
          registry.map(async (asset) => {
            const response = await fetch(dataUrl(asset.csvFile));
            if (!response.ok) return [asset.id, [] as Row[]] as const;
            const csv = await response.text();
            const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, dynamicTyping: true, skipEmptyLines: true });
            return [asset.id, normalizeRows(parsed.data)] as const;
          }),
        );
        if (cancelled) return;
        setAssets(registry);
        setPresetDefinitions(presets);
        setData(Object.fromEntries(loaded));
        const preferredIds = ["msci_world", "gold", "us_lt_govt_bonds"];
        const initialSelection = preferredIds.filter((id) => registry.some((asset) => asset.id === id));
        setSelected(initialSelection);
        setWeights(Object.fromEntries(registry.map((asset) => [asset.id, initialSelection.includes(asset.id) ? 100 / initialSelection.length : 0])));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Impossible de charger les données.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const selectedAssets = useMemo(() => assets.filter((asset) => selected.includes(asset.id) && data[asset.id]?.length), [assets, data, selected]);
  const commonStart = selectedAssets.length ? Math.max(...selectedAssets.map((asset) => data[asset.id][0].year)) : 1970;
  const commonEnd = selectedAssets.length ? Math.min(...selectedAssets.map((asset) => data[asset.id][data[asset.id].length - 1].year)) : 2025;
  const effectiveRange: [number, number] = commonPeriod ? [commonStart, commonEnd] : range;
  const [start, end] = effectiveRange;
  const duration = Math.max(0, end - start + 1);

  const stats = useMemo(() => Object.fromEntries(selectedAssets.map((asset) => [asset.id, computeStats(data[asset.id], start, end, mode)])), [data, end, mode, selectedAssets, start]);

  const years = useMemo(() => {
    const allYears = new Set<number>();
    selectedAssets.forEach((asset) => data[asset.id].forEach((row) => { if (row.year >= start && row.year <= end) allYears.add(row.year); }));
    return [...allYears].sort((a, b) => a - b);
  }, [data, end, selectedAssets, start]);

  const annualData = useMemo(() => years.map((year) => {
    const point: Record<string, number | null> = { year };
    selectedAssets.forEach((asset) => {
      const row = data[asset.id].find((candidate) => candidate.year === year);
      point[asset.id] = row ? returnValue(row, mode) : null;
    });
    return point;
  }), [data, mode, selectedAssets, years]);

  const priceData = useMemo(() => {
    const lastCpi = Object.fromEntries(selectedAssets.map((asset) => {
      const row = data[asset.id].filter((candidate) => candidate.year >= start && candidate.year <= end && Number.isFinite(candidate.cpi)).at(-1);
      return [asset.id, row?.cpi ?? 100];
    }));
    return years.map((year) => {
      const point: Record<string, number | null> = { year };
      selectedAssets.forEach((asset) => {
        const row = data[asset.id].find((candidate) => candidate.year === year);
        if (!row || !Number.isFinite(row.price)) point[asset.id] = null;
        else point[asset.id] = mode === "real" && Number.isFinite(row.cpi) ? row.price / row.cpi * lastCpi[asset.id] : row.price;
      });
      return point;
    });
  }, [data, end, mode, selectedAssets, start, years]);

  const growthData = useMemo(() => {
    const values = Object.fromEntries(selectedAssets.map((asset) => [asset.id, 100]));
    return [{ year: start - 1, ...values }, ...years.map((year) => {
      const point: Record<string, number | null> = { year };
      selectedAssets.forEach((asset) => {
        const row = data[asset.id].find((candidate) => candidate.year === year);
        const value = row ? returnValue(row, mode) : null;
        if (value === null) point[asset.id] = null;
        else {
          values[asset.id] *= 1 + value / 100;
          point[asset.id] = Math.round(values[asset.id] * 10) / 10;
        }
      });
      return point;
    })];
  }, [data, mode, selectedAssets, start, years]);

  const decadeData = useMemo(() => {
    const grouped = new Map<number, Record<string, number[]>>();
    selectedAssets.forEach((asset) => data[asset.id].forEach((row) => {
      const value = returnValue(row, mode);
      if (row.year < start || row.year > end || value === null) return;
      const decade = Math.floor(row.year / 10) * 10;
      const group = grouped.get(decade) ?? {};
      group[asset.id] = [...(group[asset.id] ?? []), value];
      grouped.set(decade, group);
    }));
    return [...grouped.entries()].sort(([a], [b]) => a - b).map(([decade, group]) => {
      const point: Record<string, number | string> = { decade: `${decade}s` };
      selectedAssets.forEach((asset) => {
        const values = group[asset.id] ?? [];
        point[asset.id] = values.length ? (Math.pow(values.reduce((total, value) => total * (1 + value / 100), 1), 1 / values.length) - 1) * 100 : 0;
      });
      return point;
    });
  }, [data, end, mode, selectedAssets, start]);

  const visiblePhases = historicalPhases.filter((phase) => phase.start >= start && phase.end <= end);

  const portfolioWeights = Object.fromEntries(selectedAssets.map((asset) => [asset.id, weights[asset.id] ?? 0]));
  const portfolio = computePortfolio(data, portfolioWeights, start, end, mode);
  const correlations = computeCorrelationMatrix(data, selectedAssets.map((asset) => asset.id), start, end, mode);

  const selectPreset = (presetId: Exclude<PresetId, "custom">) => {
    const preset = presetDefinitions.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    setPresetModified(false);
    setSelected(Object.keys(preset.weights).filter((id) => preset.weights[id] > 0));
    setWeights((current) => ({ ...current, ...preset.weights }));
    setCommonPeriod(false);
    setRange([preset.start, preset.end]);
    setActiveTab("portfolio");
  };

  const selectCustom = () => {
    setActivePreset("custom");
    setPresetModified(false);
  };

  const toggleAsset = (id: string) => {
    if (activePreset !== "custom") return;
    setSelected((current) => {
      if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current;
      if (current.length >= 4) return current;
      setWeights((previous) => ({ ...previous, [id]: 0 }));
      return [...current, id];
    });
  };

  const updateWeight = (id: string, value: number) => {
    if (activePreset !== "custom") setPresetModified(true);
    setWeights((current) => ({ ...current, [id]: Math.max(0, Math.min(100, value)) }));
  };

  const normalizeWeights = () => {
    if (activePreset !== "custom") setPresetModified(true);
    const total = selectedAssets.reduce((sum, asset) => sum + (weights[asset.id] ?? 0), 0);
    if (total <= 0) {
      const equalWeight = 100 / selectedAssets.length;
      setWeights((current) => selectedAssets.reduce((next, asset) => ({ ...next, [asset.id]: equalWeight }), { ...current }));
      return;
    }
    setWeights((current) => selectedAssets.reduce((next, asset) => ({ ...next, [asset.id]: (current[asset.id] ?? 0) / total * 100 }), { ...current }));
  };

  const activeLabel = mode === "nominal" ? "nominal" : "réel";
  const selectedCount = selectedAssets.length;

  return (
    <main className="app-shell">
      <div className="grain" />
      <div className="page-frame">
        <header className="hero">
          <div>
            <p className="eyebrow"><span className="eyebrow-dot" /> Laboratoire patrimonial · données 1925–2025</p>
            {isCorrelationPage ? <><h1>Corrélations<br /><em>entre actifs</em></h1><p className="hero-copy">Explorer les relations entre les grandes classes d'actifs et repérer les combinaisons les plus complémentaires.</p></> : <><h1>Allocation<br /><em>d'actifs</em></h1><p className="hero-copy">Comparer les moteurs de performance, les périodes de stress et la résistance réelle des grandes classes d'actifs.</p></>}
          </div>
          <div className="hero-note"><span>01</span><p>Une lecture historique<br />avant toute allocation.</p></div>
        </header>

        <nav className="page-navigation" aria-label="Navigation principale">
          <a className={!isCorrelationPage ? "active" : ""} href="/">Analyse des actifs</a>
          <a className={isCorrelationPage ? "active" : ""} href="/correlations">Corrélations</a>
        </nav>

        {loading && <div className="loading-panel"><Activity size={18} /> Chargement du corpus historique...</div>}
        {error && <div className="error-panel"><CircleHelp size={18} /> {error}</div>}

        {!loading && !error && (
          isCorrelationPage ? (
            <CorrelationView assets={assets} data={data} mode="nominal" />
          ) : <>
            <section className="control-panel">
              <div className="control-heading"><div><span className="section-index">A</span><h2>{activePreset === "custom" ? "Univers de comparaison" : "Allocation candidate"}</h2></div><span className="selection-count">{activePreset === "custom" ? `${selectedCount}/4 sélectionnés` : `${presetDefinitions.find((preset) => preset.id === activePreset)?.label ?? "Candidate"}${presetModified ? " · modifiée" : ""}`}</span></div>
              <div className="preset-chips">
                <button className={`preset-chip custom ${activePreset === "custom" ? "selected" : ""}`} onClick={selectCustom}><span className="chip-dot" /> À la carte</button>
                {presetDefinitions.map((preset) => <button key={preset.id} className={`preset-chip ${activePreset === preset.id ? "selected" : ""}`} onClick={() => selectPreset(preset.id)}><span className="chip-dot" /> {preset.label}</button>)}
              </div>
              <p className="preset-description">{activePreset === "custom" ? "Sélectionne les actifs à comparer et construis ta propre allocation." : `${presetDefinitions.find((preset) => preset.id === activePreset)?.description ?? "Allocation candidate calculée sur les données historiques."}${presetModified ? " Les pondérations ont été modifiées." : ""}`}</p>
              <div className={`asset-chips ${activePreset !== "custom" ? "locked" : ""}`}>
                {assets.map((asset) => {
                  const isSelected = selected.includes(asset.id);
                  return <button key={asset.id} className={`asset-chip ${isSelected ? "selected" : ""}`} style={{ "--asset-color": asset.accentColor } as React.CSSProperties} onClick={() => toggleAsset(asset.id)} disabled={activePreset !== "custom" || (!isSelected && selected.length >= 4)}>
                    <span className="chip-dot" /> {asset.name}
                  </button>;
                })}
              </div>
              <div className="control-row">
                <label className="switch-control"><input type="checkbox" checked={commonPeriod} onChange={(event) => setCommonPeriod(event.target.checked)} /><span className="switch" /> Période commune <strong>{commonStart}–{commonEnd}</strong></label>
                {!commonPeriod && <label className="range-control">De <input type="number" value={range[0]} onChange={(event) => setRange([Number(event.target.value), range[1]])} /> à <input type="number" value={range[1]} onChange={(event) => setRange([range[0], Number(event.target.value)])} /></label>}
                <div className="mode-toggle"><button className={mode === "nominal" ? "active" : ""} onClick={() => setMode("nominal")}>Nominal</button><button className={mode === "real" ? "active" : ""} onClick={() => setMode("real")}>Réel</button></div>
              </div>
            </section>

            <section className="signal-strip">
              <div><span className="strip-label">Fenêtre analysée</span><strong>{start} <span>→</span> {end}</strong><small>{duration} années</small></div>
              <div><span className="strip-label">Lecture courante</span><strong>{mode === "nominal" ? "Rendements nominaux" : "Rendements après inflation"}</strong><small>Dividendes réinvestis quand disponibles</small></div>
              <div><span className="strip-label">Actifs actifs</span><strong>{selectedCount}</strong><small>{activePreset === "custom" ? "Maximum quatre séries" : "Ventilation de la candidate"}</small></div>
            </section>

            <nav className="tabs" aria-label="Vues d'analyse">{chartTabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}<button className={activeTab === "portfolio" ? "active" : ""} onClick={() => setActiveTab("portfolio")}>Portefeuille</button><button className={activeTab === "correlations" ? "active" : ""} onClick={() => setActiveTab("correlations")}>Corrélations</button></nav>

            {activeTab === "overview" && <Overview assets={selectedAssets} stats={stats} mode={mode} start={start} end={end} />}
            {activeTab === "price" && <ChartCard title={`Niveaux de prix ${mode === "real" ? "réels" : "nominaux"}`} subtitle="Une échelle propre à chaque actif. Utilisez la croissance cumulée pour comparer les trajectoires." icon={<SlidersHorizontal size={18} />}><ResponsiveContainer width="100%" height={390}><LineChart data={priceData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis scale="log" domain={["auto", "auto"]} {...axisProps} tickFormatter={(value) => value >= 1000 ? `${Math.round(value / 1000)}k` : value} /><Tooltip content={<ChartTooltip assets={assets} type="number" />} /><Legend formatter={(value) => assets.find((asset) => asset.id === value)?.name ?? value} />{selectedAssets.map((asset) => <Line key={asset.id} type="monotone" dataKey={asset.id} stroke={asset.accentColor} strokeWidth={2.5} dot={false} connectNulls={false} />)}</LineChart></ResponsiveContainer></ChartCard>}
            {activeTab === "returns" && <ChartCard title={`Rendements annuels ${activeLabel}s`} subtitle="Les années positives et négatives sont affichées côte à côte pour faire ressortir les régimes de marché." icon={<BarChart3 size={18} />}><ResponsiveContainer width="100%" height={390}><BarChart data={annualData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis {...axisProps} tickFormatter={(value) => `${value}%`} /><Tooltip content={<ChartTooltip assets={assets} type="percent" />} /><Legend formatter={(value) => assets.find((asset) => asset.id === value)?.name ?? value} /><ReferenceLine y={0} stroke="#18324a" />{selectedAssets.map((asset) => <Bar key={asset.id} dataKey={asset.id} fill={asset.accentColor} radius={[3, 3, 0, 0]} />)}</BarChart></ResponsiveContainer></ChartCard>}
            {activeTab === "growth" && <ChartCard title={`100 $ investis en ${start}`} subtitle={`Croissance cumulée en termes ${activeLabel}s, avec réinvestissement des rendements disponibles.`} icon={<Activity size={18} />}><ResponsiveContainer width="100%" height={390}><AreaChart data={growthData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis scale="log" domain={["auto", "auto"]} {...axisProps} tickFormatter={formatMoney} /><Tooltip content={<ChartTooltip assets={assets} type="money" />} /><Legend formatter={(value) => assets.find((asset) => asset.id === value)?.name ?? value} />{selectedAssets.map((asset) => <Area key={asset.id} type="monotone" dataKey={asset.id} stroke={asset.accentColor} fill={asset.accentColor} fillOpacity={0.08} strokeWidth={2.5} connectNulls={false} />)}</AreaChart></ResponsiveContainer></ChartCard>}
            {activeTab === "decades" && <ChartCard title={`TCAM par décennie · ${activeLabel}`} subtitle="Moyenne géométrique des rendements annuels disponibles dans chaque décennie." icon={<CalendarDays size={18} />}><ResponsiveContainer width="100%" height={390}><BarChart data={decadeData}><ChartGrid /><XAxis dataKey="decade" {...axisProps} /><YAxis {...axisProps} tickFormatter={(value) => `${value}%`} /><Tooltip content={<ChartTooltip assets={assets} type="percent" />} /><Legend formatter={(value) => assets.find((asset) => asset.id === value)?.name ?? value} /><ReferenceLine y={0} stroke="#18324a" />{selectedAssets.map((asset) => <Bar key={asset.id} dataKey={asset.id} fill={asset.accentColor} radius={[3, 3, 0, 0]} />)}</BarChart></ResponsiveContainer></ChartCard>}

             {activeTab === "portfolio" && <PortfolioView assets={selectedAssets} weights={weights} portfolio={portfolio} correlations={correlations} mode={mode} presetModified={presetModified} activePreset={activePreset} onWeightChange={updateWeight} onNormalize={normalizeWeights} />}
              {activeTab === "correlations" && <CorrelationView assets={selectedAssets} data={data} mode={mode} embedded start={start} end={end} />}

             {activeTab !== "correlations" && <HistoricalTable assets={selectedAssets} data={data} phases={visiblePhases} mode={mode} />}
          </>
        )}

        <footer><span>Sources consolidées : Federal Reserve · MSCI · FTSE NAREIT · Bloomberg · CoinGecko</span><span>Analyse exploratoire · USD · 1925–2025</span></footer>
      </div>
    </main>
  );
}

const axisProps = { tick: { fill: "#718096", fontSize: 11 }, axisLine: false, tickLine: false };

function ChartGrid() { return <CartesianGrid stroke="#e4e9ee" strokeDasharray="2 4" vertical={false} />; }

function CorrelationView({
  assets,
  data,
  mode: parentMode,
  embedded = false,
  start: embeddedStart,
  end: embeddedEnd,
}: {
  assets: Asset[];
  data: Dataset;
  mode: Mode;
  embedded?: boolean;
  start?: number;
  end?: number;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [range, setRange] = useState<[number, number]>([1970, 2025]);
  const [commonPeriod, setCommonPeriod] = useState(false);
  const [pageMode, setPageMode] = useState<Mode>(parentMode);

  useEffect(() => {
    if (embedded || !assets.length) return;
    setSelectedIds((current) => current.length ? current.filter((id) => assets.some((asset) => asset.id === id)) : assets.map((asset) => asset.id));
  }, [assets, embedded]);

  const selectedAssets = useMemo(() => embedded
    ? assets.filter((asset) => data[asset.id]?.length)
    : assets.filter((asset) => selectedIds.includes(asset.id) && data[asset.id]?.length), [assets, data, embedded, selectedIds]);
  const commonStart = selectedAssets.length ? Math.max(...selectedAssets.map((asset) => data[asset.id][0].year)) : range[0];
  const commonEnd = selectedAssets.length ? Math.min(...selectedAssets.map((asset) => data[asset.id].at(-1)?.year ?? range[1])) : range[1];
  const [start, end] = embedded
    ? [embeddedStart ?? commonStart, embeddedEnd ?? commonEnd]
    : commonPeriod ? [commonStart, commonEnd] : range;
  const mode = embedded ? parentMode : pageMode;
  const periodLabel = `${start}–${end}`;

  const details = useMemo(
    () => computeCorrelationDetails(data, selectedAssets.map((asset) => asset.id), start, end, mode),
    [data, end, mode, selectedAssets, start],
  );

  const performanceData = useMemo(() => selectedAssets.map((asset) => {
    const stat = computeStats(data[asset.id], start, end, mode);
    return { asset, cagr: mode === "nominal" ? stat?.cagrNominal ?? null : stat?.cagrReal ?? null, observations: stat?.count ?? 0 };
  }).sort((left, right) => (right.cagr ?? -Infinity) - (left.cagr ?? -Infinity)), [data, end, mode, selectedAssets, start]);

  const pairs = useMemo(() => {
    const result: Array<{ left: Asset; right: Asset; value: number; observations: number }> = [];
    selectedAssets.forEach((left, leftIndex) => selectedAssets.slice(leftIndex + 1).forEach((right) => {
      const cell = details[left.id]?.[right.id];
      if (cell?.value !== null && cell?.value !== undefined) result.push({ left, right, value: cell.value, observations: cell.observations });
    }));
    return result;
  }, [details, selectedAssets]);

  const leastCorrelated = pairs.length ? [...pairs].sort((left, right) => left.value - right.value)[0] : null;
  const mostCorrelated = pairs.length ? [...pairs].sort((left, right) => right.value - left.value)[0] : null;
  const averageCorrelation = pairs.length ? pairs.reduce((sum, pair) => sum + pair.value, 0) / pairs.length : null;
  const diversificationAsset = selectedAssets.length > 1
    ? selectedAssets.map((asset) => {
      const values = selectedAssets.filter((other) => other.id !== asset.id).map((other) => details[asset.id]?.[other.id]?.value).filter((value): value is number => value !== null && value !== undefined);
      return { asset, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
    }).filter((entry) => entry.value !== null).sort((left, right) => (left.value as number) - (right.value as number))[0] ?? null
    : null;

  const toggleAsset = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current;
      return [...current, id];
    });
  };

  return <div className="correlation-layout">
    <section className={`correlation-controls ${embedded ? "embedded" : ""}`}>
      <div className="card-heading compact">
        <div className="heading-icon"><Activity size={17} /></div>
        <div><h2>Univers de corrélation</h2><p>{embedded ? "Actifs sélectionnés dans le picker principal. Les contrôles de période et de mode sont partagés avec l'analyse." : "Tous les actifs sont inclus par défaut. Les cellules utilisent uniquement les années communes à chaque paire."}</p></div>
      </div>
      {!embedded && <>
        <div className="correlation-assets">
          {assets.map((asset) => <button key={asset.id} className={`correlation-asset-chip ${selectedIds.includes(asset.id) ? "selected" : ""}`} style={{ "--asset-color": asset.accentColor } as React.CSSProperties} onClick={() => toggleAsset(asset.id)}><span className="chip-dot" />{asset.name}</button>)}
        </div>
        <div className="correlation-control-row">
          <label className="switch-control"><input type="checkbox" checked={commonPeriod} onChange={(event) => setCommonPeriod(event.target.checked)} /><span className="switch" />Période commune <strong>{commonStart}–{commonEnd}</strong></label>
          {!commonPeriod && <label className="range-control">De <input type="number" value={range[0]} min={1925} max={range[1] - 1} onChange={(event) => setRange([Number(event.target.value), range[1]])} /> à <input type="number" value={range[1]} min={range[0] + 1} max={2025} onChange={(event) => setRange([range[0], Number(event.target.value)])} /></label>}
          <div className="mode-toggle"><button className={mode === "nominal" ? "active" : ""} onClick={() => setPageMode("nominal")}>Nominal</button><button className={mode === "real" ? "active" : ""} onClick={() => setPageMode("real")}>Réel</button></div>
          <span className="correlation-period">{selectedAssets.length} actifs · {periodLabel} · lecture {mode === "nominal" ? "nominale" : "réelle"}</span>
        </div>
      </>}
      {embedded && <span className="correlation-period">{selectedAssets.length} actifs · {periodLabel} · lecture {mode === "nominal" ? "nominale" : "réelle"}</span>}
    </section>

    {selectedAssets.length < 2 ? <div className="error-panel correlation-empty">Sélectionnez au moins deux actifs pour calculer une corrélation.</div> : <>
      <section className="correlation-summary">
        <div className="correlation-kpi"><span>Paire complémentaire</span><strong>{leastCorrelated ? `${leastCorrelated.left.name} · ${leastCorrelated.right.name}` : "n.d."}</strong><small>{leastCorrelated ? leastCorrelated.value.toFixed(2) : "Aucune paire disponible"}</small></div>
        <div className="correlation-kpi"><span>Actif le plus diversifiant</span><strong>{diversificationAsset?.asset.name ?? "n.d."}</strong><small>{diversificationAsset ? `Moyenne : ${diversificationAsset.value?.toFixed(2)}` : "Aucune paire disponible"}</small></div>
        <div className="correlation-kpi"><span>Paire la plus redondante</span><strong>{mostCorrelated ? `${mostCorrelated.left.name} · ${mostCorrelated.right.name}` : "n.d."}</strong><small>{mostCorrelated ? mostCorrelated.value.toFixed(2) : "Aucune paire disponible"}</small></div>
        <div className="correlation-kpi"><span>Corrélation moyenne des paires</span><strong>{averageCorrelation === null ? "n.d." : averageCorrelation.toFixed(2)}</strong><small>Diagonale exclue · {pairs.length} paires</small></div>
      </section>

      <section className="table-card correlation-matrix-card">
        <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Matrice des corrélations</h2><p>Rendements {mode === "nominal" ? "nominaux" : "réels"} sur {periodLabel}. Survolez une cellule pour voir le nombre d’observations.</p></div></div>
        <div className="correlation-matrix-scroll"><div className="correlation-matrix" style={{ gridTemplateColumns: `minmax(160px, 1.5fr) repeat(${selectedAssets.length}, minmax(78px, 1fr))` }}>
          <div className="correlation-corner">Actif</div>
          {selectedAssets.map((asset) => <div className="correlation-header" key={asset.id} style={{ color: asset.accentColor }}>{asset.name}</div>)}
          {selectedAssets.flatMap((asset) => [
            <div className="correlation-row-label" key={`${asset.id}-label`}><span className="chip-dot" style={{ background: asset.accentColor }} />{asset.name}</div>,
            ...selectedAssets.map((other) => {
              const cell = details[asset.id]?.[other.id];
              const value = cell?.value ?? null;
              const diagonal = asset.id === other.id;
              return <div key={`${asset.id}-${other.id}`} className={`correlation-cell ${diagonal ? "diagonal" : ""} ${value === null ? "unavailable" : ""}`} style={{ backgroundColor: correlationColor(value, diagonal) }} title={value === null ? `${cell?.observations ?? 0} observations` : `${value.toFixed(2)} · ${cell?.observations ?? 0} observations`}>
                {value === null ? "n.d." : value.toFixed(2)}
              </div>;
            }),
          ])}
        </div></div>
        <div className="correlation-legend"><span><i style={{ background: correlationColor(-1, false) }} />-1,00</span><span><i style={{ background: correlationColor(0, false) }} />0,00</span><span><i style={{ background: correlationColor(1, false) }} />+1,00</span><span>n.d. : données insuffisantes</span></div>
      </section>

      <section className="chart-card correlation-chart-card">
        <div className="card-heading compact"><div className="heading-icon warm"><BarChart3 size={17} /></div><div><h2>TCAM par actif</h2><p>Rendement annualisé composé sur {periodLabel}, en termes {mode === "nominal" ? "nominaux" : "réels"}.</p></div></div>
        <div className="chart-wrap"><ResponsiveContainer width="100%" height={Math.max(300, performanceData.length * 42)}><BarChart data={performanceData} layout="vertical" margin={{ top: 4, right: 20, left: 12, bottom: 4 }}>
          <ChartGrid /><XAxis type="number" {...axisProps} tickFormatter={(value) => `${value}%`} /><YAxis type="category" dataKey="asset.name" width={170} {...axisProps} /><Tooltip formatter={(value) => formatPercent(Number(value))} labelFormatter={(label) => String(label)} /><ReferenceLine x={0} stroke="#18324a" />
          <Bar dataKey="cagr" radius={[0, 3, 3, 0]}>{performanceData.map((entry) => <Cell key={entry.asset.id} fill={entry.asset.accentColor} />)}</Bar>
        </BarChart></ResponsiveContainer></div>
        <p className="chart-footnote">Le TCAM mesure la performance finale annualisée. Il ne mesure pas la corrélation entre les actifs, qui se lit dans la matrice ci-dessus.</p>
      </section>

      <section className="insight-card correlation-reading">
        <div className="card-heading compact"><div className="heading-icon cool"><CircleHelp size={17} /></div><div><h2>Focus de la période</h2><p>Lecture descriptive des résultats sélectionnés.</p></div></div>
        <p>{leastCorrelated && mostCorrelated ? <>{leastCorrelated.left.name} et {leastCorrelated.right.name} forment la paire la plus complémentaire avec une corrélation de {leastCorrelated.value.toFixed(2)}, tandis que {mostCorrelated.left.name} et {mostCorrelated.right.name} sont les plus redondants avec {mostCorrelated.value.toFixed(2)}.</> : "Les données disponibles ne permettent pas encore de produire une lecture comparative."} {performanceData[0]?.cagr !== null && performanceData[0]?.cagr !== undefined ? `${performanceData[0].asset.name} affiche le TCAM ${mode === "nominal" ? "nominal" : "réel"} le plus élevé sur la période.` : ""}</p>
      </section>
    </>}
  </div>;
}

function correlationColor(value: number | null, diagonal: boolean): string {
  if (diagonal) return "#dfe6ea";
  if (value === null) return "#f2f5f6";
  const hue = 210 - ((value + 1) / 2) * 200;
  return `hsl(${hue}, 68%, 86%)`;
}

function PortfolioView({
  assets,
  weights,
  portfolio,
  correlations,
  mode,
  activePreset,
  presetModified,
  onWeightChange,
  onNormalize,
}: {
  assets: Asset[];
  weights: Record<string, number>;
  portfolio: PortfolioStats | null;
  correlations: Record<string, Record<string, number | null>>;
  mode: Mode;
  activePreset: PresetId;
  presetModified: boolean;
  onWeightChange: (id: string, value: number) => void;
  onNormalize: () => void;
}) {
  const totalWeight = assets.reduce((sum, asset) => sum + (weights[asset.id] ?? 0), 0);
  const portfolioData = portfolio?.points ?? [];

  return <div className="portfolio-layout">
    <section className="portfolio-controls">
      <div className="card-heading compact">
        <div className="heading-icon"><SlidersHorizontal size={17} /></div>
        <div><h2>Construire une allocation</h2><p>{activePreset === "custom" ? "Les pondérations sont normalisées pour le calcul." : `${presetModified ? "Allocation candidate modifiée" : "Ventilation candidate chargée"}. Les actifs du picker sont verrouillés.`}</p></div>
      </div>
      <div className="weight-list">
        {assets.map((asset) => <label className="weight-row" key={asset.id}>
          <span className="weight-name"><i style={{ background: asset.accentColor }} />{asset.name}</span>
          <input type="number" min="0" max="100" step="1" value={Math.round((weights[asset.id] ?? 0) * 10) / 10} onChange={(event) => onWeightChange(asset.id, Number(event.target.value))} />
          <span className="weight-percent">%</span>
        </label>)}
      </div>
      <div className={`weight-total ${Math.abs(totalWeight - 100) < 0.01 ? "valid" : "invalid"}`}>
        <span>Total saisi</span><strong>{totalWeight.toFixed(1)} %</strong>
      </div>
      <button className="normalize-button" onClick={onNormalize}>Normaliser à 100 %</button>
      <p className="method-note">Simulation basée sur des rendements annuels et un rééquilibrage annuel implicite. Les résultats décrivent un scénario historique, pas une prévision.</p>
    </section>

    {portfolio ? <>
      <section className="portfolio-summary">
        <div className="portfolio-kpi"><span>TCAM {mode === "nominal" ? "nominal" : "réel"}</span><strong>{formatPercent(portfolio.cagr)}</strong></div>
        <Metric label="Volatilité" value={formatPercent(portfolio.volatility)} />
        <Metric label="Drawdown maximal" value={formatPercent(portfolio.maxDrawdown)} negative />
        <Metric label="Sharpe brut" value={portfolio.sharpe === null ? "n.d." : portfolio.sharpe.toFixed(2)} />
        <Metric label="Années positives" value={`${portfolio.positiveRate.toFixed(0)} %`} positive />
        <Metric label="Pire année" value={portfolio.worst ? `${portfolio.worst.year} · ${formatPercent(portfolio.worst.return)}` : "n.d."} negative />
      </section>
      <section className="chart-card portfolio-chart">
        <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Trajectoire de l’allocation</h2><p>Valeur de 100 unités investies au début de la période.</p></div></div>
        <ResponsiveContainer width="100%" height={330}><LineChart data={portfolioData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis scale="log" domain={["auto", "auto"]} {...axisProps} tickFormatter={formatMoney} /><Tooltip content={<PortfolioTooltip />} /><Line type="monotone" dataKey="value" name="Valeur" stroke="#e76f51" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer>
      </section>
      <section className="chart-card drawdown-chart">
        <div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Drawdown dans le temps</h2><p>Écart entre la valeur du portefeuille et son plus-haut historique.</p></div></div>
        <ResponsiveContainer width="100%" height={260}><AreaChart data={portfolioData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis {...axisProps} tickFormatter={(value) => `${value}%`} /><Tooltip content={<DrawdownTooltip />} /><ReferenceLine y={0} stroke="#18324a" /><Area type="monotone" dataKey="drawdown" name="Drawdown" stroke="#cf5b55" fill="#cf5b55" fillOpacity={0.14} /></AreaChart></ResponsiveContainer>
      </section>
      <section className="table-card correlation-card">
        <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Corrélations entre actifs</h2><p>Corrélations des rendements {mode === "nominal" ? "nominaux" : "réels"} sur la période commune.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Actif</th>{assets.map((asset) => <th key={asset.id} style={{ color: asset.accentColor }}>{asset.name}</th>)}</tr></thead><tbody>{assets.map((asset) => <tr key={asset.id}><td>{asset.name}</td>{assets.map((other) => { const value = correlations[asset.id]?.[other.id]; return <td key={other.id} className={value === null ? "" : value < 0.3 ? "positive" : value > 0.7 ? "negative" : ""}>{value === null ? "n.d." : value.toFixed(2)}</td>; })}</tr>)}</tbody></table></div>
      </section>
      <section className="table-card portfolio-table">
        <div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Années difficiles</h2><p>Les cinq baisses annuelles les plus importantes du portefeuille.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Année</th><th>Rendement</th><th>Valeur cumulée</th><th>Drawdown</th></tr></thead><tbody>{[...portfolioData].sort((a, b) => a.return - b.return).slice(0, 5).map((point) => <tr key={point.year}><td>{point.year}</td><td className={point.return >= 0 ? "positive" : "negative"}>{formatPercent(point.return)}</td><td>{formatNumber(point.value, 1)}</td><td className="negative">{formatPercent(point.drawdown)}</td></tr>)}</tbody></table></div>
      </section>
    </> : <div className="error-panel portfolio-empty">Attribue au moins une pondération à un actif disposant de données sur toute la période commune.</div>}
  </div>;
}

function PortfolioTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number | null }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong><div><span>Valeur</span><b>{formatNumber(payload[0].value, 1)}</b></div></div>;
}

function DrawdownTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number | null }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong><div><span>Drawdown</span><b>{formatPercent(payload[0].value)}</b></div></div>;
}

function ChartTooltip({ active, payload, label, assets, type }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number | null }>; label?: string | number; assets: Asset[]; type: "percent" | "money" | "number" }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => { const asset = assets.find((candidate) => candidate.id === item.dataKey); const value = item.value; return <div key={item.dataKey} style={{ color: asset?.accentColor }}><span>{asset?.name ?? item.dataKey}</span><b>{type === "percent" ? formatPercent(value) : type === "money" ? formatMoney(value ?? 0) : formatNumber(value)}</b></div>; })}</div>;
}

function ChartCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="chart-card"><div className="card-heading"><div className="heading-icon">{icon}</div><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" title="Exporter les données" aria-label="Exporter les données"><Download size={16} /></button></div><div className="chart-wrap">{children}</div></section>;
}

function Overview({ assets, stats, mode, start, end }: { assets: Asset[]; stats: Record<string, ReturnType<typeof computeStats>>; mode: Mode; start: number; end: number }) {
  return <>
    <section className="kpi-grid">{assets.map((asset) => { const stat = stats[asset.id]; if (!stat) return null; return <article className="asset-card" key={asset.id} style={{ "--asset-color": asset.accentColor } as React.CSSProperties}><div className="asset-card-top"><span className="asset-badge">{asset.name}</span><span className="asset-period">{start}–{end}</span></div><div className="main-kpi"><span>TCAM {mode === "nominal" ? "nominal" : "réel"}</span><strong>{formatPercent(mode === "nominal" ? stat.cagrNominal : stat.cagrReal)}</strong></div><div className="metric-grid"><Metric label="Volatilité" value={formatPercent(stat.volatility, 1)} /><Metric label="Années positives" value={`${stat.positiveRate.toFixed(0)} %`} /><Metric label="Meilleure année" value={stat.best ? `${stat.best.year} · ${formatPercent(returnValue(stat.best, mode))}` : "n.d."} positive /><Metric label="Pire année" value={stat.worst ? `${stat.worst.year} · ${formatPercent(returnValue(stat.worst, mode))}` : "n.d."} negative /></div></article>; })}</section>
    <section className="insight-grid"><div className="insight-card"><div className="card-heading compact"><div className="heading-icon warm"><ArrowUpRight size={17} /></div><div><h2>Les meilleures années</h2><p>Top 5 · lecture {mode === "nominal" ? "nominale" : "réelle"}</p></div></div><RankingTable assets={assets} stats={stats} mode={mode} best /></div><div className="insight-card"><div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Les années difficiles</h2><p>Bottom 5 · lecture {mode === "nominal" ? "nominale" : "réelle"}</p></div></div><RankingTable assets={assets} stats={stats} mode={mode} best={false} /></div></section>
  </>;
}

function Metric({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) { return <div className={`metric ${positive ? "positive" : negative ? "negative" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }

function RankingTable({ assets, stats, mode, best }: { assets: Asset[]; stats: Record<string, ReturnType<typeof computeStats>>; mode: Mode; best: boolean }) { return <div className="ranking-table">{[0, 1, 2, 3, 4].map((index) => <div className="ranking-row" key={index}><span className="rank">0{index + 1}</span>{assets.map((asset) => { const row = (best ? stats[asset.id]?.best5 : stats[asset.id]?.worst5)?.[index]; return <div className="rank-asset" key={asset.id}><span>{asset.name}</span><strong style={{ color: asset.accentColor }}>{row ? `${row.year} · ${formatPercent(returnValue(row, mode))}` : "n.d."}</strong></div>; })}</div>)}</div>; }

function HistoricalTable({ assets, data, phases, mode }: { assets: Asset[]; data: Dataset; phases: typeof historicalPhases; mode: Mode }) {
  if (!phases.length) return null;
  return <section className="table-card"><div className="card-heading compact"><div className="heading-icon"><CalendarDays size={17} /></div><div><h2>Régimes historiques</h2><p>TCAM de chaque actif pendant les grandes séquences de marché</p></div></div><div className="table-scroll"><table><thead><tr><th>Période</th><th>Années</th>{assets.map((asset) => <th key={asset.id} style={{ color: asset.accentColor }}>{asset.name}</th>)}</tr></thead><tbody>{phases.map((phase) => <tr key={phase.name}><td><span className="phase-dot" style={{ background: phase.color }} />{phase.name}</td><td>{phase.start}–{phase.end}</td>{assets.map((asset) => { const rows = data[asset.id].filter((row) => row.year >= phase.start && row.year <= phase.end && returnValue(row, mode) !== null); const values = rows.map((row) => returnValue(row, mode) as number); const average = values.length ? (Math.pow(values.reduce((total, value) => total * (1 + value / 100), 1), 1 / values.length) - 1) * 100 : null; return <td key={asset.id} className={average !== null && average >= 0 ? "positive" : "negative"}>{formatPercent(average)}</td>; })}</tr>)}</tbody></table></div></section>;
}

export default App;
