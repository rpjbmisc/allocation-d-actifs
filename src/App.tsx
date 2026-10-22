import { useEffect, useMemo, useRef, useState } from "react";
import { loadHistoricalData } from "./data/load";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, CircleHelp, Download, EyeOff, Info, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import {
  Asset,
  Currency,
  CurrencyContext,
  computeStats,
  currencyFxReturn,
  weightedCagrDiagnostics,
  normalizeWeights as normalizeAllocationWeights,
  maxDrawdown,
  assetCoversPeriod,
  dataBounds,
  computeGrowthData,
  computeDecadeData,
  computePortfolio,
  computeCorrelationDetails,
  computeCorrelationMatrix,
  computeDiversificationMetrics,
  formatMoney,
  formatNumber,
  formatPercent,
  Mode,
  localizeRows,
  PortfolioStats,
  PortfolioOptimizationProfile,
  optimize,
  OptimizationResult,
  returnValue,
  Row,
  runWalkForward,
  WalkForwardResult,
  WalkForwardSettings,
  weightStabilityLabel,
  DEFAULT_SCENARIO_SETTINGS,
  ScenarioSettings,
  GoalSettings,
  DEFAULT_GOAL_SETTINGS,
} from "./analytics";

type Tab = "overview" | "returns" | "growth" | "decades" | "portfolio" | "correlations";
type PortfolioSpace = "construction" | "comparison" | "validation";
type Dataset = Record<string, Row[]>;
type PresetId = "custom" | "pure" | "constrained" | "robust" | "bitcoin";
type ChartRow = Record<string, number | string | null>;
type ChartColumn = { key: string; label: string };
type AssetCategory = "Tous" | "Actions" | "Obligations" | "Immobilier" | "Métaux" | "Alternatives";
type ChartMetadata = { unit: string; source: string; period: string; observations: number };
type GrowthConstraintSettings = {
  maxAnnualCloseDrawdownPct: number | null;
  maxAnnualVolatilityPct: number | null;
  maxWeightPct: number;
};
type CurrencyComparisonPoint = {
  year: number;
  usdValue: number;
  usdReturn: number;
  usdDrawdown: number;
  currentReturn: number;
  currentDrawdown: number;
  fxReturn: number | null;
};
type CurrencyComparison = { points: CurrencyComparisonPoint[]; usd: PortfolioStats };

interface CandidatePreset {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
  weights: Record<string, number>;
  start: number;
  end: number;
}

type HistoricalPhase = { id: string; name: string; start: number; end: number; color: string };

const fallbackAssets: Asset[] = [];
const historicalPhases: HistoricalPhase[] = [
  { id: "great-depression", name: "Grande Dépression", start: 1929, end: 1939, color: "#6d5ce7" },
  { id: "post-war-boom", name: "Boom d'après-guerre", start: 1946, end: 1965, color: "#2a9d8f" },
  { id: "stagflation", name: "Stagflation", start: 1970, end: 1979, color: "#e9a23b" },
  { id: "disinflation-bull", name: "Désinflation & bull 80-90s", start: 1980, end: 1999, color: "#e76f51" },
  { id: "dot-com", name: "Bulle Internet", start: 2000, end: 2002, color: "#d1495b" },
  { id: "financial-crisis", name: "Crise financière", start: 2008, end: 2009, color: "#9b2226" },
  { id: "post-gfc", name: "Reprise post-GFC", start: 2010, end: 2019, color: "#2a9d8f" },
  { id: "covid", name: "Covid & post-Covid", start: 2020, end: 2025, color: "#457b9d" },
];

const chartTabs: { id: Tab; label: string }[] = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "growth", label: "100 $ investis" },
  { id: "returns", label: "Rendements" },
  { id: "decades", label: "Décennies" },
]; 

const baseUrl = import.meta.env.BASE_URL;
const preferredIds = ["msci_world", "gold", "us_lt_govt_bonds"];
const MATRIX_ASSETS_PARAM = "matrixAssets";
const tabIds = new Set<Tab>(["overview", "returns", "growth", "decades", "portfolio", "correlations"]);
const MAX_SELECTED_ASSETS = 10;
const assetCategories: AssetCategory[] = ["Tous", "Actions", "Obligations", "Immobilier", "Métaux", "Alternatives"];
const crisisMarkers = [
  { year: 1929, label: "1929" },
  { year: 1973, label: "1973" },
  { year: 2000, label: "2000" },
  { year: 2008, label: "2008" },
  { year: 2020, label: "2020" },
];
const defaultGrowthConstraints: GrowthConstraintSettings = {
  // The historical 40% limit remains the editable starting point, not a universal rule.
  maxAnnualCloseDrawdownPct: 40,
  maxAnnualVolatilityPct: null,
  maxWeightPct: 100,
};
const defaultValidationSettings: WalkForwardSettings = {
  minTrainYears: 20,
  testYears: 5,
  expanding: true,
};
const defaultRobustScenarioSettings: ScenarioSettings = DEFAULT_SCENARIO_SETTINGS;

function assetCategory(id: string): AssetCategory {
  if (["sp500", "msci_world", "msci_world_ex_usa", "msci_world_small_cap_value", "msci_world_value", "msci_em", "russell2000", "us_total_market", "global_infrastructure"].includes(id)) return "Actions";
  if (["tbills_us", "us_lt_govt_bonds", "highyield_us"].includes(id)) return "Obligations";
  if (id === "reit_us") return "Immobilier";
  if (id === "gold") return "Métaux";
  return "Alternatives";
}

function assetUnit(id: string): string {
  if (id === "gold") return "USD / once";
  if (id === "bitcoin") return "USD / BTC";
  return "Indice / USD";
}

function candidateRisk(id: string): string {
  if (id === "bitcoin") return "Très élevé";
  if (id === "pure") return "Élevé";
  if (id === "constrained") return "Encadré";
  return "Modéré";
}

function readTab(value: string | null): Tab {
  return value && tabIds.has(value as Tab) ? value as Tab : "overview";
}

function readIds(value: string | null | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function PeriodSelector({ start, end, onChange }: { start: number; end: number; onChange: (start: number, end: number) => void }) {
  const selectedId = historicalPhases.find((phase) => phase.start === start && phase.end === end)?.id ?? "custom";
  return <label className="period-selector"><span>Période historique</span><select value={selectedId} onChange={(event) => {
    const phase = historicalPhases.find((candidate) => candidate.id === event.target.value);
    if (phase) onChange(phase.start, phase.end);
  }}><option value="custom">Dates personnalisées</option>{historicalPhases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name} ({phase.start}–{phase.end})</option>)}</select></label>;
}

function App() {
  const isCorrelationPage = window.location.pathname.replace(/\/+$/, "") === `${baseUrl}correlations`.replace(/\/+$/, "");
  const [assets, setAssets] = useState<Asset[]>(fallbackAssets);
  const [rawData, setRawData] = useState<Dataset>({});
  const [currencyContext, setCurrencyContext] = useState<CurrencyContext>({ usdPerEur: {}, frenchInflation: {} });
  const initialParams = new URLSearchParams(window.location.search);
  const [selected, setSelected] = useState<string[]>(readIds(initialParams.get("assets")));
  const [mode, setMode] = useState<Mode>(initialParams.get("mode") === "real" ? "real" : "nominal");
  const [currency, setCurrency] = useState<Currency>(initialParams.get("currency") === "usd" ? "usd" : "eur");
  const [range, setRange] = useState<[number, number]>([Number(initialParams.get("start")) || 1970, Number(initialParams.get("end")) || 2025]);
  const [commonPeriod, setCommonPeriod] = useState(initialParams.get("common") !== "false");
  const [activeTab, setActiveTab] = useState<Tab>(readTab(initialParams.get("tab")));
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<AssetCategory>("Tous");
  const [hiddenAssets, setHiddenAssets] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [automaticWeights, setAutomaticWeights] = useState(false);
  const [optimizationProfile, setOptimizationProfile] = useState<PortfolioOptimizationProfile>("growth");
  const [growthConstraints, setGrowthConstraints] = useState<GrowthConstraintSettings>(defaultGrowthConstraints);
  const [robustScenarioSettings, setRobustScenarioSettings] = useState<ScenarioSettings>(defaultRobustScenarioSettings);
  const [goalSettings, setGoalSettings] = useState<GoalSettings>(DEFAULT_GOAL_SETTINGS);
  const [validationSettings, setValidationSettings] = useState<WalkForwardSettings>(defaultValidationSettings);
  const [activePreset, setActivePreset] = useState<PresetId>("custom");
  const [presetDefinitions, setPresetDefinitions] = useState<CandidatePreset[]>([]);
  const [presetModified, setPresetModified] = useState(false);
  const automaticCandidateInitialized = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const data = useMemo(
    () => Object.fromEntries(Object.entries(rawData).map(([id, rows]) => [id, localizeRows(rows, currency, currencyContext)])),
    [currency, currencyContext, rawData],
  );
  const usdData = useMemo(
    () => Object.fromEntries(Object.entries(rawData).map(([id, rows]) => [id, localizeRows(rows, "usd", currencyContext)])),
    [currencyContext, rawData],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { assets: registry, presets, rawData, currencyContext } = await loadHistoricalData<CandidatePreset>(baseUrl);
        if (cancelled) return;
        setAssets(registry);
        setPresetDefinitions(presets);
        setRawData(rawData);
        setCurrencyContext(currencyContext);
        const sharedSelection = selected.filter((id) => registry.some((asset) => asset.id === id));
        const initialSelection = sharedSelection.length ? sharedSelection : preferredIds.filter((id) => registry.some((asset) => asset.id === id));
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

  useEffect(() => {
    if (loading || isCorrelationPage) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", activeTab);
    params.set("assets", selected.join(","));
    params.set("mode", mode);
    params.set("currency", currency);
    params.set("common", String(commonPeriod));
    params.set("start", String(range[0]));
    params.set("end", String(range[1]));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [activeTab, commonPeriod, currency, isCorrelationPage, loading, mode, range, selected]);

  const selectedAssets = useMemo(() => assets.filter((asset) => selected.includes(asset.id) && data[asset.id]?.length), [assets, data, selected]);
  const commonBounds = selectedAssets.map((asset) => dataBounds(data[asset.id], [asset.startYear, asset.endYear]));
  const commonStart = selectedAssets.length ? Math.max(...commonBounds.map(([start]) => start)) : 1970;
  const commonEnd = selectedAssets.length ? Math.min(...commonBounds.map(([, end]) => end)) : 2025;
  const effectiveRange: [number, number] = commonPeriod ? [commonStart, commonEnd] : range;
  const [start, end] = effectiveRange;
  const duration = Math.max(0, end - start + 1);

  const stats = useMemo(() => Object.fromEntries(selectedAssets.map((asset) => [asset.id, computeStats(data[asset.id], start, end, mode)])), [data, end, mode, selectedAssets, start]);
  // The search space grows exponentially, so use a coarser deterministic grid for larger selections.
  const automaticSearchStep = selectedAssets.length >= 7 ? 20 : selectedAssets.length >= 5 ? 10 : 5;
  const growthOptimization = useMemo<OptimizationResult>(() => {
    if (activePreset !== "custom" || selectedAssets.length === 0 || end <= start) {
      return {
        strategy: "growth",
        weights: null,
        feasible: false,
        diagnostics: [],
        score: null,
        stats: null,
        evaluatedCandidates: 0,
        gridStepPct: automaticSearchStep,
      };
    }
    const assetIds = selectedAssets.map((asset) => asset.id);
    return optimize("growth", {
      data,
      assetIds,
      trainStart: start,
      trainEnd: end,
      returnMode: mode,
      rebalancing: "annual",
    }, {
      longOnly: true,
      maxWeightByAsset: Object.fromEntries(assetIds.map((id) => [id, growthConstraints.maxWeightPct / 100])),
      maxAnnualCloseDrawdownPct: growthConstraints.maxAnnualCloseDrawdownPct,
      maxAnnualVolatilityPct: growthConstraints.maxAnnualVolatilityPct,
      gridStepPct: automaticSearchStep,
      maxEvaluations: 100_000,
    });
  }, [activePreset, automaticSearchStep, data, end, growthConstraints, mode, selectedAssets, start]);
  const robustOptimization = useMemo<OptimizationResult>(() => {
    if (activePreset !== "custom" || selectedAssets.length === 0 || end <= start) {
      return {
        strategy: "robust",
        weights: null,
        feasible: false,
        diagnostics: [],
        score: null,
        stats: null,
        evaluatedCandidates: 0,
        gridStepPct: automaticSearchStep,
        scoreLabel: "TCAM simulé · quantile défavorable",
        scenarioSummary: null,
      };
    }
    const assetIds = selectedAssets.map((asset) => asset.id);
    return optimize("robust", {
      data,
      assetIds,
      trainStart: start,
      trainEnd: end,
      returnMode: mode,
      rebalancing: "annual",
      scenarioSettings: robustScenarioSettings,
    }, {
      longOnly: true,
      maxWeightByAsset: Object.fromEntries(assetIds.map((id) => [id, growthConstraints.maxWeightPct / 100])),
      maxAnnualCloseDrawdownPct: growthConstraints.maxAnnualCloseDrawdownPct,
      maxAnnualVolatilityPct: growthConstraints.maxAnnualVolatilityPct,
      gridStepPct: automaticSearchStep,
      maxEvaluations: 100_000,
    });
  }, [activePreset, automaticSearchStep, data, end, growthConstraints, mode, robustScenarioSettings, selectedAssets, start]);
  const goalOptimization = useMemo<OptimizationResult>(() => {
    if (activePreset !== "custom" || !selectedAssets.length || end <= start) return {
      strategy: "goal", weights: null, feasible: false, diagnostics: [], score: null, stats: null, evaluatedCandidates: 0, gridStepPct: automaticSearchStep,
    };
    const assetIds = selectedAssets.map(asset => asset.id);
    return optimize("goal", {
      data, assetIds, trainStart: start, trainEnd: end, returnMode: mode,
      scenarioSettings: robustScenarioSettings, goalSettings,
    }, {
      longOnly: true, maxWeightByAsset: Object.fromEntries(assetIds.map(id => [id, growthConstraints.maxWeightPct / 100])),
      maxAnnualCloseDrawdownPct: growthConstraints.maxAnnualCloseDrawdownPct,
      maxAnnualVolatilityPct: growthConstraints.maxAnnualVolatilityPct,
      gridStepPct: automaticSearchStep, maxEvaluations: 100_000,
    });
  }, [activePreset, selectedAssets, end, start, automaticSearchStep, data, mode, robustScenarioSettings, goalSettings, growthConstraints]);
  const optimizationResult = optimizationProfile === "robust" ? robustOptimization : optimizationProfile === "goal" ? goalOptimization : growthOptimization;
  const automaticCandidate = useMemo(
    () => optimizationResult.weights
      ? Object.fromEntries(selectedAssets.map((asset) => [asset.id, (optimizationResult.weights?.[asset.id] ?? 0) * 100]))
      : null,
    [optimizationResult.weights, selectedAssets],
  );

  useEffect(() => {
    if (loading || activePreset !== "custom") return;
    if (!automaticCandidate) {
      setAutomaticWeights(false);
      return;
    }
    // A manual edit must remain in place until the user explicitly reapplies a profile.
    if (automaticCandidateInitialized.current && !automaticWeights) return;
    setWeights((current) => selectedAssets.reduce(
      (next, asset) => ({ ...next, [asset.id]: automaticCandidate[asset.id] ?? 0 }),
      { ...current },
    ));
    setAutomaticWeights(true);
    automaticCandidateInitialized.current = true;
  }, [activePreset, automaticCandidate, automaticWeights, loading, selectedAssets]);

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

  const growthData = useMemo(() => computeGrowthData(data, selectedAssets.map(a => a.id), start, end, mode), [data, selectedAssets, start, end, mode]);
  const decadeData = useMemo(() => computeDecadeData(data, selectedAssets.map(a => a.id), start, end, mode), [data, selectedAssets, start, end, mode]);

  const visiblePhases = historicalPhases.filter((phase) => phase.start >= start && phase.end <= end);

  const portfolioWeights = useMemo(() => Object.fromEntries(selectedAssets.map((asset) => [asset.id, weights[asset.id] ?? 0])), [selectedAssets, weights]);
  const portfolio = useMemo(() => computePortfolio(data, portfolioWeights, start, end, mode), [data, end, mode, portfolioWeights, start]);
  const usdPortfolio = useMemo(() => currency === "eur" ? computePortfolio(usdData, portfolioWeights, start, end, mode) : null, [currency, end, mode, portfolioWeights, start, usdData]);
  const currencyComparison: CurrencyComparison | null = currency === "eur" && portfolio && usdPortfolio
    ? {
        usd: usdPortfolio,
        points: portfolio.points.flatMap((point) => {
          const usdPoint = usdPortfolio.points.find((candidate) => candidate.year === point.year);
          if (!usdPoint) return [];
          return [{
            year: point.year,
            usdValue: usdPoint.value,
            usdReturn: usdPoint.return,
            usdDrawdown: usdPoint.drawdown,
            currentReturn: point.return,
            currentDrawdown: point.drawdown,
            fxReturn: currencyFxReturn(currencyContext, point.year),
          }];
        }),
      }
    : null;
  const equalWeights = useMemo(() => Object.fromEntries(selectedAssets.map((asset) => [asset.id, 100 / Math.max(1, selectedAssets.length)])), [selectedAssets]);
  const equalPortfolio = useMemo(() => computePortfolio(data, equalWeights, start, end, mode), [data, end, equalWeights, mode, start]);
  const benchmarkPortfolio = useMemo(
    () => data.msci_world ? computePortfolio(data, { msci_world: 100 }, start, end, mode) : null,
    [data, end, mode, start],
  );
  const walkForward = useMemo<WalkForwardResult>(() => {
    const assetIds = selectedAssets.map((asset) => asset.id);
    return runWalkForward({
      data,
      assetIds,
      periodStart: start,
      periodEnd: end,
      returnMode: mode,
      customWeights: portfolioWeights,
      settings: validationSettings,
      benchmarkAssetId: data.msci_world ? "msci_world" : null,
      scenarioSettings: robustScenarioSettings,
      goalSettings,
      constraints: {
        longOnly: true,
        maxWeightByAsset: Object.fromEntries(assetIds.map((id) => [id, growthConstraints.maxWeightPct / 100])),
        maxAnnualCloseDrawdownPct: growthConstraints.maxAnnualCloseDrawdownPct,
        maxAnnualVolatilityPct: growthConstraints.maxAnnualVolatilityPct,
        gridStepPct: automaticSearchStep,
        maxEvaluations: 100_000,
      },
    });
  }, [automaticSearchStep, data, end, growthConstraints, mode, portfolioWeights, robustScenarioSettings, goalSettings, selectedAssets, start, validationSettings]);
  const correlations = useMemo(() => computeCorrelationMatrix(data, selectedAssets.map((asset) => asset.id), start, end, mode), [data, end, mode, selectedAssets, start]);
  const availableAssets = assets.filter((asset) => data[asset.id]?.length);
  const periodRestricted = !commonPeriod;
  const periodEligibleAssets = useMemo(() => new Set(assets.filter((asset) => assetCoversPeriod(data[asset.id], range[0], range[1])).map((asset) => asset.id)), [assets, data, range]);
  const visibleChartAssets = selectedAssets.filter((asset) => !hiddenAssets.includes(asset.id));
  const filteredAssets = assets.filter((asset) => {
    const matchesCategory = assetCategoryFilter === "Tous" || assetCategory(asset.id) === assetCategoryFilter;
    const matchesSearch = asset.name.toLocaleLowerCase().includes(assetSearch.toLocaleLowerCase());
    return matchesCategory && matchesSearch;
  });
  const chartObservationCount = selectedAssets.reduce((sum, asset) => sum + data[asset.id].filter((row) => row.year >= start && row.year <= end && returnValue(row, mode) !== null).length, 0);
  const periodGap = selectedAssets.length ? commonStart - Math.min(...selectedAssets.map((asset) => asset.startYear)) : 0;
  const limitingAssets = selectedAssets.filter((asset) => asset.startYear === commonStart);
  const decisionStats = selectedAssets.map((asset) => {
    const stat = stats[asset.id];
    return stat ? { asset, stat, drawdown: maxDrawdown(data[asset.id], start, end, mode) } : null;
  }).filter((entry): entry is { asset: Asset; stat: NonNullable<typeof stats[string]>; drawdown: number | null } => Boolean(entry));
  const bestAsset = [...decisionStats].sort((left, right) => (mode === "nominal" ? right.stat.cagrNominal ?? -Infinity : right.stat.cagrReal ?? -Infinity) - (mode === "nominal" ? left.stat.cagrNominal ?? -Infinity : left.stat.cagrReal ?? -Infinity))[0];
  const worstReturnAsset = [...decisionStats].sort((left, right) => (mode === "nominal" ? left.stat.cagrNominal ?? Infinity : left.stat.cagrReal ?? Infinity) - (mode === "nominal" ? right.stat.cagrNominal ?? Infinity : right.stat.cagrReal ?? Infinity))[0];
  const lowestRiskAsset = [...decisionStats].sort((left, right) => left.stat.volatility - right.stat.volatility)[0];
  const worstDrawdownAsset = [...decisionStats].sort((left, right) => (left.drawdown ?? 0) - (right.drawdown ?? 0))[0];
  const cagrDiagnostics = weightedCagrDiagnostics(stats, portfolioWeights, mode);
  const portfolioContributions = selectedAssets.map(asset => ({ asset, ...cagrDiagnostics[asset.id] }));
  const diversificationMetrics = useMemo(
    () => computeDiversificationMetrics(data, selectedAssets.map((asset) => asset.id), portfolioWeights, portfolio, start, end, mode),
    [data, end, mode, portfolio, portfolioWeights, selectedAssets, start],
  );
  const weightedCorrelation = diversificationMetrics.weightedCorrelation;
  const diversificationRatio = diversificationMetrics.diversificationRatio;

  const selectPreset = (presetId: Exclude<PresetId, "custom">) => {
    const preset = presetDefinitions.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    setOptimizationProfile("growth");
    setAutomaticWeights(false);
    setPresetModified(false);
    setSelected(Object.keys(preset.weights).filter((id) => preset.weights[id] > 0));
    setWeights((current) => ({ ...current, ...preset.weights }));
    setCommonPeriod(false);
    setRange([preset.start, preset.end]);
    setActiveTab("portfolio");
  };

  const selectCustom = () => {
    automaticCandidateInitialized.current = false;
    setActivePreset("custom");
    setOptimizationProfile("growth");
    setAutomaticWeights(false);
    setPresetModified(false);
  };

  const toggleAsset = (id: string) => {
    if (activePreset !== "custom") return;
    setOptimizationProfile("growth");
    setSelected((current) => {
      if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current;
      if (current.length >= MAX_SELECTED_ASSETS) return current;
      setWeights((previous) => ({ ...previous, [id]: 0 }));
      return [...current, id];
    });
  };

  const updateWeight = (id: string, value: number) => {
    setAutomaticWeights(false);
    if (activePreset !== "custom") setPresetModified(true);
    setWeights((current) => ({ ...current, [id]: Math.max(0, Math.min(100, value)) }));
  };

  const normalizeWeights = () => {
    setAutomaticWeights(false);
    if (activePreset !== "custom") setPresetModified(true);
    const total = selectedAssets.reduce((sum, asset) => sum + (weights[asset.id] ?? 0), 0);
    if (total <= 0 && selectedAssets.length > 0) {
      const equalWeight = 100 / selectedAssets.length;
      setWeights((current) => selectedAssets.reduce((next, asset) => ({ ...next, [asset.id]: equalWeight }), { ...current }));
      return;
    }
    setWeights((current) => selectedAssets.reduce((next, asset) => ({ ...next, [asset.id]: (current[asset.id] ?? 0) / total * 100 }), { ...current }));
  };

  const resetConfiguration = () => {
    automaticCandidateInitialized.current = false;
    const initialSelection = preferredIds.filter((id) => availableAssets.some((asset) => asset.id === id));
    const fallbackSelection = initialSelection.length ? initialSelection : availableAssets.slice(0, 3).map((asset) => asset.id);
    setActivePreset("custom");
    setOptimizationProfile("growth");
    setAutomaticWeights(false);
    setPresetModified(false);
    setSelected(fallbackSelection);
    setWeights(Object.fromEntries(assets.map((asset) => [asset.id, fallbackSelection.includes(asset.id) ? 100 / Math.max(1, fallbackSelection.length) : 0])));
    setCommonPeriod(true);
    setRange([1970, 2025]);
    setCurrency("eur");
    setMode("nominal");
    setRobustScenarioSettings(defaultRobustScenarioSettings);
    setActiveTab("overview");
    setHiddenAssets([]);
    setConfigurationOpen(false);
  };

  const applyOptimizationProfile = (profile: PortfolioOptimizationProfile) => {
    const proposal = profile === "growth" ? growthOptimization : profile === "robust" ? robustOptimization : goalOptimization;
    if (!proposal.weights) return;
    setOptimizationProfile(profile);
    setAutomaticWeights(true);
    setWeights((current) => selectedAssets.reduce(
      (next, asset) => ({ ...next, [asset.id]: (proposal.weights?.[asset.id] ?? 0) * 100 }),
      { ...current },
    ));
  };

  const toggleHiddenAsset = (id: string) => {
    setHiddenAssets((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const activeLabel = mode === "nominal" ? "nominal" : "réel";
  const selectedCount = selectedAssets.length;
  const chartColumns: ChartColumn[] = [{ key: "year", label: "Année" }, ...selectedAssets.map((asset) => ({ key: asset.id, label: asset.name }))];
  const decadeColumns: ChartColumn[] = [{ key: "decade", label: "Décennie" }, ...selectedAssets.map((asset) => ({ key: asset.id, label: asset.name }))];

  return (
    <main className="app-shell">
      <div className="grain" />
      <div className="page-frame">
        <header className="hero">
          <div>
            <p className="eyebrow"><span className="eyebrow-dot" /> Laboratoire patrimonial · données 1925–2025</p>
            {isCorrelationPage ? <><h1>Matrice<br /><em>globale</em></h1><p className="hero-copy">Explorer les relations historiques entre les grandes classes d'actifs et repérer les combinaisons les plus complémentaires.</p></> : <><h1>Allocation<br /><em>d'actifs</em></h1><p className="hero-copy">Comparer les moteurs de performance, les périodes de stress et la résistance réelle des grandes classes d'actifs.</p></>}
          </div>
          <div className="hero-note"><span>01</span><p>Une lecture historique<br />avant toute allocation.</p></div>
        </header>

        <nav className="page-navigation" aria-label="Navigation principale">
          <a className={!isCorrelationPage ? "active" : ""} aria-current={!isCorrelationPage ? "page" : undefined} href={baseUrl}>Analyse des actifs</a>
          <a className={isCorrelationPage ? "active" : ""} aria-current={isCorrelationPage ? "page" : undefined} href={`${baseUrl}correlations`}>Matrice globale</a>
        </nav>

        {loading && <div className="loading-panel"><Activity size={18} /> Chargement du corpus historique...</div>}
        {error && <div className="error-panel"><CircleHelp size={18} /> {error}</div>}

        {!loading && !error && (
          isCorrelationPage ? (
            <CorrelationView assets={assets} data={data} mode="nominal" />
          ) : <>
             <section className="control-panel">
               <div className="context-bar">
                 <div className="context-selection"><span className="section-index">Analyse active</span><div className="context-assets">{selectedAssets.length ? selectedAssets.map((asset) => <span key={asset.id} className="context-asset" style={{ "--asset-color": asset.accentColor } as React.CSSProperties}><i />{asset.name}</span>) : <span className="context-empty">Aucun actif sélectionné</span>}</div></div>
                 <div className="context-detail"><span>Période</span><strong>{selectedCount ? `${start}–${end}` : "—"}</strong></div>
                  <div className="context-detail"><span>Devise</span><strong>{currency === "eur" ? "EUR non couvert" : "USD"}</strong></div>
                  <div className="context-detail"><span>Lecture</span><strong>{mode === "nominal" ? "Nominal" : "Réel"}</strong></div>
                 <div className="context-actions"><button className="context-edit" onClick={() => setConfigurationOpen((open) => !open)}>{configurationOpen ? "Fermer" : "Modifier"}</button><button className="reset-button" onClick={resetConfiguration} title="Réinitialiser la configuration"><RotateCcw size={14} /> Réinitialiser</button></div>
               </div>
               {commonPeriod && periodGap >= 5 && <div className="context-warning"><AlertTriangle size={15} /><span>La période commune est limitée à <strong>{commonStart}–{commonEnd}</strong> par {limitingAssets.map((asset) => asset.name).join(", ")}.</span><button onClick={() => setConfigurationOpen(true)}>Voir pourquoi</button></div>}
               {configurationOpen && <div className="configuration-editor">
                <div className="control-heading"><div><div className="section-index">Configuration</div><h2>Préparer l'analyse</h2></div><div className="control-heading-actions"><span className="selection-count">{activePreset === "custom" ? `${selectedCount}/${MAX_SELECTED_ASSETS} sélectionnés` : `${presetDefinitions.find((preset) => preset.id === activePreset)?.label ?? "Candidate"}${presetModified ? " · modifiée" : ""}`}</span></div></div>
               <div className="configuration-steps">
                  <section className="configuration-step">
                     <div className="step-heading"><span className="step-number">01</span><div><h3>Actifs</h3><p>Choisis jusqu'à dix séries à comparer.</p></div><strong>{selectedCount}/{MAX_SELECTED_ASSETS}</strong></div>
                    <div className="candidate-grid">
                       <button className={`candidate-card custom ${activePreset === "custom" ? "selected" : ""}`} onClick={selectCustom}><div className="candidate-card-heading"><strong>À la carte</strong><span>Libre</span></div><p>Construire une sélection et une allocation personnalisées.</p><div className="candidate-card-footer">Jusqu'à {MAX_SELECTED_ASSETS} actifs</div></button>
                      {presetDefinitions.map((preset) => <button key={preset.id} className={`candidate-card ${activePreset === preset.id ? "selected" : ""}`} onClick={() => selectPreset(preset.id)}><div className="candidate-card-heading"><strong>{preset.label}</strong><span>Risque {candidateRisk(preset.id)}</span></div><p>{preset.description}</p><div className="candidate-allocation">{Object.entries(preset.weights).filter(([, weight]) => weight > 0).map(([id, weight]) => { const asset = assets.find((candidate) => candidate.id === id); return <span key={id} style={{ width: `${weight}%`, background: asset?.accentColor ?? "#9aa8b0" }} title={`${asset?.name ?? id}: ${weight} %`} />; })}</div><div className="candidate-card-footer">{preset.start}–{preset.end} · {Object.values(preset.weights).filter((weight) => weight > 0).length} actifs</div></button>)}
                    </div>
                    <p className="preset-description">{activePreset === "custom" ? "Sélectionne les actifs à comparer et construis ta propre allocation." : `${presetDefinitions.find((preset) => preset.id === activePreset)?.description ?? "Allocation candidate calculée sur les données historiques."}${presetModified ? " Les pondérations ont été modifiées." : ""}`}</p>
                    <div className="asset-picker-toolbar">
                      <label className="asset-search"><Search size={15} /><span className="sr-only">Rechercher un actif</span><input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Rechercher un actif" /></label>
                      <div className="asset-categories" aria-label="Catégories d'actifs">{assetCategories.map((category) => <button key={category} className={assetCategoryFilter === category ? "active" : ""} onClick={() => setAssetCategoryFilter(category)}>{category}</button>)}</div>
                    </div>
                    <div className={`asset-chips ${activePreset !== "custom" ? "locked" : ""}`}>
                      {filteredAssets.map((asset) => {
                         const isSelected = selected.includes(asset.id);
                         const hasData = Boolean(data[asset.id]?.length);
                         const availableForPeriod = !periodRestricted || periodEligibleAssets.has(asset.id);
                          return <button key={asset.id} className={`asset-chip ${isSelected ? "selected" : ""} ${!hasData || !availableForPeriod ? "unavailable" : ""}`} style={{ "--asset-color": asset.accentColor } as React.CSSProperties} onClick={() => toggleAsset(asset.id)} disabled={!hasData || (periodRestricted && !availableForPeriod) || activePreset !== "custom" || (!isSelected && selected.length >= MAX_SELECTED_ASSETS)} title={!hasData ? "Données indisponibles" : !availableForPeriod ? `Indice non disponible sur ${range[0]}–${range[1]}` : undefined} aria-pressed={isSelected}>
                           <span className="chip-dot" /> <span>{asset.name}</span><small>{asset.startYear}–{asset.endYear}</small>{!hasData && <small>indisponible</small>}{hasData && !availableForPeriod && <small>hors période</small>}
                         </button>;
                      })}
                    </div>
                    {!filteredAssets.length && <div className="configuration-message">Aucun actif ne correspond à cette recherche.</div>}
                    {!availableAssets.length && <div className="configuration-message error"><CircleHelp size={16} /> Aucune série historique n'est disponible pour le moment.</div>}
                    {commonPeriod && periodGap >= 5 && <div className="configuration-message warning"><AlertTriangle size={16} /><span><strong>La période commune est raccourcie.</strong> {limitingAssets.map((asset) => asset.name).join(", ")} commence{limitingAssets.length > 1 ? "nt" : ""} en {commonStart}, ce qui retire {periodGap} années à l'historique disponible.</span></div>}
                  </section>

                 <section className="configuration-step">
                   <div className="step-heading"><span className="step-number">02</span><div><h3>Période</h3><p>Définis la fenêtre historique à analyser.</p></div><strong>{start}–{end}</strong></div>
                   <div className="control-row">
                      <label className="switch-control"><input type="checkbox" checked={commonPeriod} onChange={(event) => { setOptimizationProfile("growth"); setCommonPeriod(event.target.checked); }} /><span className="switch" /> <span>Utiliser la période commune</span></label>
                      {commonPeriod && <strong className="period-value">{selectedCount ? `${commonStart}–${commonEnd}` : "En attente d'actifs"}</strong>}
                       {!commonPeriod && <label className="range-control">De <input type="number" value={range[0]} onChange={(event) => { setOptimizationProfile("growth"); setRange([Number(event.target.value), range[1]]); }} /> à <input type="number" value={range[1]} onChange={(event) => { setOptimizationProfile("growth"); setRange([range[0], Number(event.target.value)]); }} /></label>}
                     </div>
                      <PeriodSelector start={range[0]} end={range[1]} onChange={(nextStart, nextEnd) => { setOptimizationProfile("growth"); setCommonPeriod(false); setRange([nextStart, nextEnd]); }} />
                    <p className="period-explanation">{commonPeriod ? selectedCount ? `La période s'ajuste automatiquement aux années disponibles pour les ${selectedCount} actifs sélectionnés. Elle sera recalculée à chaque changement.` : "Sélectionne au moins un actif pour calculer la période commune." : "Chaque actif est analysé sur la période saisie, lorsque ses données sont disponibles. Les actifs dont les données CSV ne couvrent pas toute la plage sont désactivés."}</p>
                 </section>

                  <section className="configuration-step">
                    <div className="step-heading"><span className="step-number">03</span><div><h3>Lecture</h3><p>Choisis l'effet de l'inflation sur les rendements.</p></div><strong>{mode === "nominal" ? "Nominal" : "Réel"}</strong></div>
                      <div className="mode-toggle"><button className={mode === "nominal" ? "active" : ""} onClick={() => { if (mode !== "nominal") { setOptimizationProfile("growth"); setMode("nominal"); } }}>Nominal</button><button className={mode === "real" ? "active" : ""} onClick={() => { if (mode !== "real") { setOptimizationProfile("growth"); setMode("real"); } }}>Réel</button></div>
                    <p className="period-explanation">Nominal conserve les montants courants ; réel retire l'effet de l'inflation.</p>
                  </section>
                  <section className="configuration-step">
                    <div className="step-heading"><span className="step-number">04</span><div><h3>Devise de référence</h3><p>Le mode EUR convertit les rendements USD sans couverture de change.</p></div><strong>{currency === "eur" ? "EUR" : "USD"}</strong></div>
                      <div className="mode-toggle"><button className={currency === "usd" ? "active" : ""} onClick={() => { if (currency !== "usd") { setOptimizationProfile("growth"); setCurrency("usd"); } }}>USD historique</button><button className={currency === "eur" ? "active" : ""} onClick={() => { if (currency !== "eur") { setOptimizationProfile("growth"); setCurrency("eur"); } }}>EUR non couvert</button></div>
                    <p className="period-explanation">En EUR, la série commence en 1961 et utilise le taux USD/EUR historique puis le taux BCE à partir de 1999.</p>
                  </section>
               </div>
               {selectedCount === 0 && <div className="configuration-message empty"><CircleHelp size={16} /> Sélectionne au moins un actif pour commencer l'analyse.</div>}
               </div>}
             </section>

             {selectedCount > 0 && <>
             <section className="signal-strip">
              <div><span className="strip-label">Fenêtre analysée</span><strong>{start} <span>→</span> {end}</strong><small>{duration} années</small></div>
               <div><span className="strip-label">Lecture courante</span><strong>{currency === "eur" ? "EUR non couvert" : "USD"} · {mode === "nominal" ? "Nominaux" : "Après inflation"}</strong><small>Dividendes réinvestis quand disponibles</small></div>
               <div><span className="strip-label">Actifs actifs</span><strong>{selectedCount}</strong><small>{activePreset === "custom" ? `Maximum ${MAX_SELECTED_ASSETS} séries` : "Ventilation de la candidate"}</small></div>
             </section>

              <DecisionSummary bestAsset={bestAsset} worstReturnAsset={worstReturnAsset} lowestRiskAsset={lowestRiskAsset} worstDrawdownAsset={worstDrawdownAsset} mode={mode} />

             <nav className="tabs" aria-label="Vues d'analyse" role="tablist">{chartTabs.map((tab) => <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}<button role="tab" aria-selected={activeTab === "portfolio"} className={activeTab === "portfolio" ? "active" : ""} onClick={() => setActiveTab("portfolio")}>Portefeuille</button><button role="tab" aria-selected={activeTab === "correlations"} className={activeTab === "correlations" ? "active" : ""} onClick={() => setActiveTab("correlations")}>Corrélations de la sélection</button></nav>

            {activeTab === "overview" && <Overview assets={selectedAssets} stats={stats} mode={mode} start={start} end={end} />}
              {activeTab === "returns" && <ChartCard title={`Rendements annuels ${activeLabel}s`} subtitle="Les années positives et négatives sont affichées côte à côte pour faire ressortir les régimes de marché." icon={<BarChart3 size={18} />} data={annualData} columns={chartColumns} format="percent" legend={<AssetLegend assets={selectedAssets} hiddenAssets={hiddenAssets} onToggle={toggleHiddenAsset} />} metadata={{ unit: "% par an", source: "Corpus historique consolidé", period: `${start}–${end}`, observations: chartObservationCount }}><ResponsiveContainer width="100%" height={390}><BarChart data={annualData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis {...axisProps} tickFormatter={(value) => `${value}%`} /><Tooltip content={<ChartTooltip assets={assets} type="percent" />} /><ReferenceLine y={0} stroke="#18324a" />{crisisMarkers.filter((marker) => marker.year >= start && marker.year <= end).map((marker) => <ReferenceLine key={marker.year} x={marker.year} stroke="#a6b3bb" strokeDasharray="4 4" label={{ value: marker.label, position: "insideTop", fill: "#718290", fontSize: 10 }} />)}{visibleChartAssets.map((asset) => <Bar key={asset.id} dataKey={asset.id} fill={asset.accentColor} radius={[3, 3, 0, 0]} />)}</BarChart></ResponsiveContainer></ChartCard>}
              {activeTab === "growth" && <ChartCard title={`100 $ investis en ${start}`} subtitle={`Croissance cumulée en termes ${activeLabel}s, avec réinvestissement des rendements disponibles.`} icon={<Activity size={18} />} data={growthData} columns={chartColumns} format="money" legend={<AssetLegend assets={selectedAssets} hiddenAssets={hiddenAssets} onToggle={toggleHiddenAsset} />} metadata={{ unit: "Valeur de 100 $ · échelle logarithmique", source: "Corpus historique consolidé", period: `${start}–${end}`, observations: chartObservationCount }}><ResponsiveContainer width="100%" height={390}><AreaChart data={growthData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis scale="log" domain={["auto", "auto"]} {...axisProps} tickFormatter={formatMoney} /><Tooltip content={<ChartTooltip assets={assets} type="money" />} />{crisisMarkers.filter((marker) => marker.year >= start && marker.year <= end).map((marker) => <ReferenceLine key={marker.year} x={marker.year} stroke="#a6b3bb" strokeDasharray="4 4" label={{ value: marker.label, position: "insideTop", fill: "#718290", fontSize: 10 }} />)}{visibleChartAssets.map((asset) => <Area key={asset.id} type="monotone" dataKey={asset.id} stroke={asset.accentColor} fill={asset.accentColor} fillOpacity={0.08} strokeWidth={2.5} connectNulls={false} />)}</AreaChart></ResponsiveContainer></ChartCard>}
              {activeTab === "decades" && <ChartCard title={`TCAM par décennie · ${activeLabel}`} subtitle="Moyenne géométrique des rendements annuels disponibles dans chaque décennie." icon={<CalendarDays size={18} />} data={decadeData} columns={decadeColumns} format="percent" legend={<AssetLegend assets={selectedAssets} hiddenAssets={hiddenAssets} onToggle={toggleHiddenAsset} />} metadata={{ unit: "% annualisé par décennie", source: "Corpus historique consolidé", period: `${start}–${end}`, observations: chartObservationCount }}><ResponsiveContainer width="100%" height={390}><BarChart data={decadeData}><ChartGrid /><XAxis dataKey="decade" {...axisProps} /><YAxis {...axisProps} tickFormatter={(value) => `${value}%`} /><Tooltip content={<ChartTooltip assets={assets} type="percent" />} /><ReferenceLine y={0} stroke="#18324a" />{visibleChartAssets.map((asset) => <Bar key={asset.id} dataKey={asset.id} fill={asset.accentColor} radius={[3, 3, 0, 0]} />)}</BarChart></ResponsiveContainer></ChartCard>}

                  {activeTab === "portfolio" && <PortfolioView
                    assets={selectedAssets}
                    data={data}
                    phases={visiblePhases}
                    weights={weights}
                    portfolio={portfolio}
                    equalPortfolio={equalPortfolio}
                    currencyComparison={currencyComparison}
                    contributions={portfolioContributions}
                    correlations={correlations}
                    weightedCorrelation={weightedCorrelation}
                    diversificationRatio={diversificationRatio}
                    mode={mode}
                    presetModified={presetModified}
                    automaticWeights={automaticWeights}
                    activePreset={activePreset}
                     optimizationProfile={optimizationProfile}
                     growthConstraints={growthConstraints}
                     growthOptimization={optimizationResult}
                     growthProposal={growthOptimization}
                     robustProposal={robustOptimization} goalProposal={goalOptimization} goalSettings={goalSettings} onGoalSettingsChange={(next) => setGoalSettings(current => ({ ...current, ...next }))}
                     robustScenarioSettings={robustScenarioSettings}
                     benchmarkPortfolio={benchmarkPortfolio}
                    walkForward={walkForward}
                    validationSettings={validationSettings}
                    onWeightChange={updateWeight}
                    onNormalize={normalizeWeights}
                    onOptimizationProfileChange={applyOptimizationProfile}
                     onGrowthConstraintsChange={(next) => setGrowthConstraints((current) => ({ ...current, ...next }))}
                     onRobustScenarioSettingsChange={(next) => setRobustScenarioSettings((current) => ({ ...current, ...next }))}
                     onValidationSettingsChange={(next) => setValidationSettings((current) => ({ ...current, ...next }))}
                  />}
              {activeTab === "correlations" && <CorrelationView assets={selectedAssets} data={data} mode={mode} embedded start={start} end={end} />}

              {activeTab !== "correlations" && activeTab !== "portfolio" && <HistoricalTable assets={selectedAssets} data={data} phases={visiblePhases} mode={mode} />}
             </>}
           </>
        )}

         <footer><span>Sources consolidées : Federal Reserve · MSCI · FTSE NAREIT · Bloomberg · CoinGecko</span><span>Analyse exploratoire · {currency === "eur" ? "EUR non couvert · 1961–2025" : "USD · 1925–2025"}</span></footer>
      </div>
    </main>
  );
}

const axisProps = { tick: { fill: "#718096", fontSize: 11 }, axisLine: false, tickLine: false };

function ChartGrid() { return <CartesianGrid stroke="#e4e9ee" strokeDasharray="2 4" vertical={false} />; }

function DecisionSummary({
  bestAsset,
  worstReturnAsset,
  lowestRiskAsset,
  worstDrawdownAsset,
  mode,
}: {
  bestAsset?: { asset: Asset; stat: NonNullable<ReturnType<typeof computeStats>>; drawdown: number | null };
  worstReturnAsset?: { asset: Asset; stat: NonNullable<ReturnType<typeof computeStats>>; drawdown: number | null };
  lowestRiskAsset?: { asset: Asset; stat: NonNullable<ReturnType<typeof computeStats>>; drawdown: number | null };
  worstDrawdownAsset?: { asset: Asset; stat: NonNullable<ReturnType<typeof computeStats>>; drawdown: number | null };
  mode: Mode;
}) {
  const cagr = (entry?: typeof bestAsset) => entry ? mode === "nominal" ? entry.stat.cagrNominal : entry.stat.cagrReal : null;
  return <section className="decision-summary" aria-label="Résumé décisionnel">
     <div className="decision-card positive"><span>Meilleur rendement</span><strong>{bestAsset?.asset.name ?? "n.d."}</strong><small>{bestAsset ? formatPercent(cagr(bestAsset)) : "Données insuffisantes"}</small></div>
     <div className="decision-card negative"><span>Pire rendement</span><strong>{worstReturnAsset?.asset.name ?? "n.d."}</strong><small>{worstReturnAsset ? formatPercent(cagr(worstReturnAsset)) : "Données insuffisantes"}</small></div>
     <div className="decision-card neutral"><span>Risque le plus faible</span><strong>{lowestRiskAsset?.asset.name ?? "n.d."}</strong><small>{lowestRiskAsset ? `Volatilité ${formatPercent(lowestRiskAsset.stat.volatility)}` : "Données insuffisantes"}</small></div>
    <div className="decision-card negative"><span>Pire drawdown</span><strong>{worstDrawdownAsset?.asset.name ?? "n.d."}</strong><small>{worstDrawdownAsset?.drawdown !== null && worstDrawdownAsset?.drawdown !== undefined ? formatPercent(worstDrawdownAsset.drawdown) : "Données insuffisantes"}</small></div>
  </section>;
}

function AssetLegend({ assets, hiddenAssets, onToggle }: { assets: Asset[]; hiddenAssets: string[]; onToggle: (id: string) => void }) {
  return <div className="asset-legend" aria-label="Visibilité des séries">{assets.map((asset) => {
    const hidden = hiddenAssets.includes(asset.id);
    return <button key={asset.id} className={hidden ? "hidden" : ""} aria-pressed={!hidden} onClick={() => onToggle(asset.id)}><i style={{ background: asset.accentColor }} />{asset.name}{hidden && <EyeOff size={13} />}</button>;
  })}</div>;
}

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
  const correlationParams = !embedded ? new URLSearchParams(window.location.search) : null;
  const [selectedIds, setSelectedIds] = useState<string[]>(readIds(correlationParams?.get(MATRIX_ASSETS_PARAM)));
  const [range, setRange] = useState<[number, number]>([Number(correlationParams?.get("start")) || 1970, Number(correlationParams?.get("end")) || 2025]);
  const [commonPeriod, setCommonPeriod] = useState(correlationParams?.get("common") === "true");
  const [pageMode, setPageMode] = useState<Mode>(correlationParams?.get("mode") === "real" ? "real" : parentMode);

  useEffect(() => {
    if (embedded || !assets.length) return;
    setSelectedIds((current) => current.length ? current.filter((id) => assets.some((asset) => asset.id === id)) : assets.map((asset) => asset.id));
  }, [assets, embedded]);

  const selectedAssets = useMemo(() => embedded
    ? assets.filter((asset) => data[asset.id]?.length)
    : assets.filter((asset) => selectedIds.includes(asset.id) && data[asset.id]?.length), [assets, data, embedded, selectedIds]);

  const periodRestricted = !embedded && !commonPeriod;
  const periodEligibleAssets = useMemo(() => new Set(assets.filter((asset) => assetCoversPeriod(data[asset.id], range[0], range[1])).map((asset) => asset.id)), [assets, data, range]);

  useEffect(() => {
    if (!periodRestricted) return;
    setSelectedIds((current) => {
      const next = current.filter((id) => periodEligibleAssets.has(id));
      return next.length === current.length ? current : next;
    });
  }, [periodEligibleAssets, periodRestricted]);

  useEffect(() => {
    if (embedded || !selectedAssets.length) return;
    const params = new URLSearchParams(window.location.search);
    params.set(MATRIX_ASSETS_PARAM, selectedIds.join(","));
    params.set("mode", pageMode);
    params.set("common", String(commonPeriod));
    params.set("start", String(range[0]));
    params.set("end", String(range[1]));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [commonPeriod, embedded, pageMode, range, selectedAssets.length, selectedIds]);
  const commonBounds = selectedAssets.map((asset) => dataBounds(data[asset.id], [asset.startYear, asset.endYear]));
  const commonStart = selectedAssets.length ? Math.max(...commonBounds.map(([start]) => start)) : range[0];
  const commonEnd = selectedAssets.length ? Math.min(...commonBounds.map(([, end]) => end)) : range[1];
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
    if (periodRestricted && !periodEligibleAssets.has(id)) return;
    setSelectedIds((current) => {
      if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current;
      return [...current, id];
    });
  };

  return <div className="correlation-layout">
    <section className={`correlation-controls ${embedded ? "embedded" : ""}`}>
      <div className="card-heading compact">
        <div className="heading-icon"><Activity size={17} /></div>
         <div><h2>{embedded ? "Corrélations de la sélection" : "Univers de corrélation"}</h2><p>{embedded ? "Lecture des actifs sélectionnés dans l'analyse principale, avec la même période et le même mode." : "Les actifs disponibles sur toute la période sont inclus par défaut. Les cellules utilisent uniquement les années communes à chaque paire."}</p></div>
      </div>
      {!embedded && <>
        <div className="correlation-assets">
           {assets.map((asset) => { const availableForPeriod = !periodRestricted || periodEligibleAssets.has(asset.id); return <button key={asset.id} aria-pressed={selectedIds.includes(asset.id)} className={`correlation-asset-chip ${selectedIds.includes(asset.id) ? "selected" : ""} ${!availableForPeriod ? "unavailable" : ""}`} style={{ "--asset-color": asset.accentColor } as React.CSSProperties} onClick={() => toggleAsset(asset.id)} disabled={!availableForPeriod} title={!availableForPeriod ? `Indice non disponible sur ${range[0]}–${range[1]}` : undefined}><span className="chip-dot" />{asset.name}{!availableForPeriod && <small>hors période</small>}</button>; })}
        </div>
        <div className="correlation-control-row">
          <label className="switch-control"><input type="checkbox" checked={commonPeriod} onChange={(event) => setCommonPeriod(event.target.checked)} /><span className="switch" />Période commune <strong>{commonStart}–{commonEnd}</strong></label>
           {!commonPeriod && <label className="range-control">De <input type="number" value={range[0]} min={1925} max={range[1] - 1} onChange={(event) => setRange([Number(event.target.value), range[1]])} /> à <input type="number" value={range[1]} min={range[0] + 1} max={2025} onChange={(event) => setRange([range[0], Number(event.target.value)])} /></label>}
           <div className="mode-toggle"><button aria-pressed={mode === "nominal"} className={mode === "nominal" ? "active" : ""} onClick={() => setPageMode("nominal")}>Nominal</button><button aria-pressed={mode === "real"} className={mode === "real" ? "active" : ""} onClick={() => setPageMode("real")}>Réel</button></div>
           <span className="correlation-period">{selectedAssets.length} actifs · {periodLabel} · lecture {mode === "nominal" ? "nominale" : "réelle"}</span>
         </div>
         <PeriodSelector start={range[0]} end={range[1]} onChange={(nextStart, nextEnd) => { setCommonPeriod(false); setRange([nextStart, nextEnd]); }} />
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
        <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Matrice globale</h2><p>Rendements {mode === "nominal" ? "nominaux" : "réels"} sur {periodLabel}. Chaque cellule affiche sa valeur et son nombre d'observations.</p></div></div>
        <div className="correlation-matrix-scroll"><div className="correlation-matrix" style={{ gridTemplateColumns: `minmax(160px, 1.5fr) repeat(${selectedAssets.length}, minmax(78px, 1fr))` }}>
          <div className="correlation-corner">Actif</div>
          {selectedAssets.map((asset) => <div className="correlation-header" key={asset.id} style={{ color: asset.accentColor }}>{asset.name}</div>)}
          {selectedAssets.flatMap((asset) => [
            <div className="correlation-row-label" key={`${asset.id}-label`}><span className="chip-dot" style={{ background: asset.accentColor }} />{asset.name}</div>,
            ...selectedAssets.map((other) => {
              const cell = details[asset.id]?.[other.id];
              const value = cell?.value ?? null;
              const diagonal = asset.id === other.id;
              const observations = cell?.observations ?? 0;
              return <div key={`${asset.id}-${other.id}`} className={`correlation-cell ${diagonal ? "diagonal" : ""} ${value === null ? "unavailable" : ""}`} style={{ backgroundColor: correlationColor(value, diagonal) }} aria-label={`${asset.name}, ${other.name}: ${value === null ? "donnée indisponible" : value.toFixed(2)}, ${observations} observations`} title={`${observations} observations`}>
                <strong>{value === null ? "n.d." : value.toFixed(2)}</strong><small>n={observations}</small>
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

function optimizationProfileLabel(profile: PortfolioOptimizationProfile): string {
  return profile === "growth" ? "Croissance" : profile === "robust" ? "Robustesse" : "Objectif patrimonial";
}

function optimizationProfileDescription(profile: PortfolioOptimizationProfile): string {
  return profile === "growth" ? "meilleur TCAM historique sous contraintes configurables" : profile === "robust" ? "quantile défavorable du TCAM simulé" : "probabilité d’atteindre un capital cible";
}

function PortfolioView({
  assets,
  data,
  phases,
  weights,
  portfolio,
  equalPortfolio,
  currencyComparison,
  contributions,
  correlations,
  weightedCorrelation,
  diversificationRatio,
  mode,
  activePreset,
  presetModified,
  automaticWeights,
  optimizationProfile,
  growthConstraints,
  growthOptimization,
  growthProposal,
  robustProposal,
  goalProposal,
  goalSettings,
  onGoalSettingsChange,
  robustScenarioSettings,
  benchmarkPortfolio,
  walkForward,
  validationSettings,
  onWeightChange,
  onNormalize,
  onOptimizationProfileChange,
  onGrowthConstraintsChange,
  onRobustScenarioSettingsChange,
  onValidationSettingsChange,
}: {
  assets: Asset[];
  data: Dataset;
  phases: typeof historicalPhases;
  weights: Record<string, number>;
  portfolio: PortfolioStats | null;
  equalPortfolio: PortfolioStats | null;
  currencyComparison: CurrencyComparison | null;
  contributions: Array<{ asset: Asset; weight: number; contribution: number | null }>;
  correlations: Record<string, Record<string, number | null>>;
  weightedCorrelation: number | null;
  diversificationRatio: number | null;
  mode: Mode;
  activePreset: PresetId;
  presetModified: boolean;
  automaticWeights: boolean;
  optimizationProfile: PortfolioOptimizationProfile;
  growthConstraints: GrowthConstraintSettings;
  growthOptimization: OptimizationResult;
  growthProposal: OptimizationResult;
  robustProposal: OptimizationResult;
  goalProposal: OptimizationResult;
  goalSettings: GoalSettings;
  onGoalSettingsChange: (next: Partial<GoalSettings>) => void;
  robustScenarioSettings: ScenarioSettings;
  benchmarkPortfolio: PortfolioStats | null;
  walkForward: WalkForwardResult;
  validationSettings: WalkForwardSettings;
  onWeightChange: (id: string, value: number) => void;
  onNormalize: () => void;
  onOptimizationProfileChange: (profile: PortfolioOptimizationProfile) => void;
  onGrowthConstraintsChange: (next: Partial<GrowthConstraintSettings>) => void;
  onRobustScenarioSettingsChange: (next: Partial<ScenarioSettings>) => void;
  onValidationSettingsChange: (next: Partial<WalkForwardSettings>) => void;
}) {
  const [space, setSpace] = useState<PortfolioSpace>("construction");
  const totalWeight = assets.reduce((sum, asset) => sum + (weights[asset.id] ?? 0), 0);
  const fractions = normalizeAllocationWeights(Object.fromEntries(assets.map(asset => [asset.id, weights[asset.id] ?? 0])));
  const normalizedWeights = Object.fromEntries(assets.map(asset => [asset.id, (fractions?.[asset.id] ?? 0) * 100]));
  const portfolioData = portfolio?.points ?? [];
  const drawdownData = currencyComparison
    ? portfolioData.map((point) => ({ ...point, ...(currencyComparison.points.find((comparisonPoint) => comparisonPoint.year === point.year) ?? {}) }))
    : portfolioData;
  const trajectoryData = currencyComparison
    ? portfolioData.map((point) => ({ ...point, usdValue: currencyComparison.points.find((comparisonPoint) => comparisonPoint.year === point.year)?.usdValue ?? null }))
    : portfolioData;
  const profileOptions: Array<{ id: PortfolioOptimizationProfile; label: string; shortDescription: string }> = [
    { id: "growth", label: "Croissance", shortDescription: growthProposal.feasible ? "TCAM historique maximal" : "Aucune solution faisable" },
    { id: "robust", label: "Robustesse", shortDescription: robustProposal.feasible ? "Mieux résister aux années difficiles" : "Aucune solution possible" },
    { id: "goal", label: "Objectif patrimonial", shortDescription: goalProposal.feasible ? "Atteindre un capital cible" : "Aucune solution possible" },
  ];

  return <div className="portfolio-view">
    <nav className="portfolio-spaces" aria-label="Espaces du portefeuille" role="tablist">
      {([[
        "construction", "Construction",
      ], ["comparison", "Comparaison"], ["validation", "Validation"]] as Array<[PortfolioSpace, string]>).map(([id, label]) => <button key={id} role="tab" aria-selected={space === id} className={space === id ? "active" : ""} onClick={() => setSpace(id)}>{label}</button>)}
    </nav>
    {space === "construction" && <div className="portfolio-layout">
    <section className="portfolio-controls">
      <div className="card-heading compact">
        <div className="heading-icon"><SlidersHorizontal size={17} /></div>
        <div><h2>Construire une allocation</h2><p>{activePreset === "custom" ? automaticWeights ? growthOptimization.feasible ? `Proposition automatique : ${optimizationProfileDescription(optimizationProfile)}. Tu peux modifier les pondérations.` : "Aucune allocation ne respecte les contraintes choisies." : growthOptimization.feasible ? `Pondérations personnalisées. Profil sélectionné : ${optimizationProfileLabel(optimizationProfile)}.` : "Aucune allocation historique ne peut être calculée sur cette configuration." : `${presetModified ? "Allocation candidate modifiée" : "Ventilation candidate chargée"}. Les actifs du picker sont verrouillés.`}</p></div>
      </div>
      {activePreset === "custom" && <div className="optimization-profiles">
        <div className="optimization-profiles-heading"><span>Proposition automatique</span><small>Calculée sur la configuration actuelle</small></div>
        <div className="optimization-profile-list" role="group" aria-label="Profils d'optimisation">
          {profileOptions.map((profile) => <button key={profile.id} className={`optimization-profile ${optimizationProfile === profile.id ? "active" : ""}`} disabled={profile.id === "growth" ? !growthProposal.feasible : profile.id === "robust" ? !robustProposal.feasible : !goalProposal.feasible} onClick={() => onOptimizationProfileChange(profile.id)} title={(profile.id === "growth" ? growthProposal : profile.id === "robust" ? robustProposal : goalProposal).feasible ? profile.shortDescription : "Aucune allocation ne respecte les contraintes choisies"}>
            <strong>{profile.label}</strong><span>{profile.shortDescription}</span>
          </button>)}
        </div>
        {optimizationProfile === "goal" && <div className="robust-settings" aria-label="Réglages de l'objectif patrimonial">
          <div className="robust-simple-heading"><strong>Quel capital souhaites-tu atteindre ?</strong><p>Les simulations utilisent les rendements annuels historiques dans la devise et le mode nominal/réel affichés.</p></div>
          <div className="robust-settings-grid">
            <label>Capital initial <input aria-label="Capital initial" type="number" min="0" value={goalSettings.initialCapital} onChange={event => onGoalSettingsChange({ initialCapital: Number(event.target.value) })} /></label>
            <label>Versement annuel, fin d'année <input aria-label="Versement annuel" type="number" min="0" value={goalSettings.annualContribution} onChange={event => onGoalSettingsChange({ annualContribution: Number(event.target.value) })} /></label>
            <label>Capital cible <input aria-label="Capital cible" type="number" min="1" value={goalSettings.targetCapital} onChange={event => onGoalSettingsChange({ targetCapital: Number(event.target.value) })} /></label>
            <label>Horizon <input aria-label="Horizon patrimonial" type="number" min="1" max="100" value={goalSettings.horizonYears} onChange={event => onGoalSettingsChange({ horizonYears: Number(event.target.value) })} /> ans</label>
          </div>
          {goalProposal.goalSummary && <div className="robust-simple-result"><strong>{goalProposal.goalSummary.probabilityPct.toFixed(1)} % des simulations atteignent l'objectif</strong>
            <p>Capital médian : {formatMoney(goalProposal.goalSummary.medianCapital)} · scénario défavorable (10 %) : {formatMoney(goalProposal.goalSummary.lowerCapital)}.</p>
            <small>Estimation conditionnelle aux années historiques rééchantillonnées, sans frais ni fiscalité ; versements en fin d'année. Pour des euros constants, activer « Réel ».</small></div>}
          {goalProposal.diagnostics.filter(d => !d.startsWith("Probabilité indicative")).map(d => <p key={d} className="optimization-profile-note">{d}</p>)}
          <p className="method-note">Pour appliquer la nouvelle proposition après modification, clique de nouveau sur « Objectif patrimonial ».</p>
        </div>}
        {optimizationProfile === "robust" && <div className="robust-settings" aria-label="Réglages de robustesse">
          <div className="robust-simple-heading"><strong>Et si les prochaines années étaient difficiles ?</strong><p>L'application essaie plusieurs suites possibles d'années passées et cherche une répartition qui s'en sort bien, même quand les résultats sont moins bons.</p></div>
          <fieldset className="robust-prudence">
            <legend>À quel point veux-tu privilégier les scénarios difficiles ?</legend>
            <div className="robust-prudence-options">
              {([ { value: 30, label: "Un peu", detail: "30 % des scénarios sont moins bons" }, { value: 20, label: "Moyennement", detail: "20 % des scénarios sont moins bons" }, { value: 10, label: "Beaucoup", detail: "10 % des scénarios sont moins bons" } ] as const).map(option => <label key={option.value} className={robustScenarioSettings.quantilePct === option.value ? "selected" : ""}><input type="radio" name="robust-quantile" checked={robustScenarioSettings.quantilePct === option.value} onChange={() => onRobustScenarioSettingsChange({ quantilePct: option.value })} /><span><strong>{option.label}</strong><small>{option.detail}</small></span></label>)}
            </div>
          </fieldset>
          {robustProposal.scenarioSummary && <div className="robust-simple-result">
            <strong>Dans les simulations : {formatPercent(robustProposal.scenarioSummary.quantileCagr)} par an au seuil choisi</strong>
            <p>Environ {robustProposal.scenarioSummary.quantilePct} % des simulations font moins bien. Le résultat du milieu est de {formatPercent(robustProposal.scenarioSummary.medianCagr)} par an.</p>
            <small>Ce n'est pas une prévision ni un rendement garanti : les simulations réutilisent les années du passé.</small>
          </div>}
          <details className="robust-advanced">
            <summary>Réglages avancés (facultatifs)</summary>
            <p>Ces réglages servent à fabriquer les simulations. Tu peux garder les valeurs proposées.</p>
            <div className="robust-settings-grid">
              <label>Nombre de simulations <input aria-label="Nombre de scénarios" type="number" min="1" max="10000" step="1" value={robustScenarioSettings.scenarioCount} onChange={(event) => onRobustScenarioSettingsChange({ scenarioCount: Math.max(1, Math.min(10000, Number(event.target.value) || 1)) })} /></label>
              <label>Durée de chaque simulation <input aria-label="Horizon des scénarios" type="number" min="1" max="1000" step="1" value={robustScenarioSettings.horizonYears} onChange={(event) => onRobustScenarioSettingsChange({ horizonYears: Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })} /> <span>ans</span></label>
              <label>Années conservées à la suite <input aria-label="Taille des blocs historiques" type="number" min="1" max="100" step="1" value={robustScenarioSettings.blockYears} onChange={(event) => onRobustScenarioSettingsChange({ blockYears: Math.max(1, Math.min(100, Number(event.target.value) || 1)) })} /> <span>an{robustScenarioSettings.blockYears > 1 ? "s" : ""}</span></label>
              <label>Numéro pour retrouver les mêmes tirages <input aria-label="Graine des scénarios" type="number" step="1" value={robustScenarioSettings.seed} onChange={(event) => onRobustScenarioSettingsChange({ seed: Number(event.target.value) || 0 })} /></label>
              <label>Seuil défavorable exact <input aria-label="Quantile défavorable" type="number" min="0" max="50" step="1" value={robustScenarioSettings.quantilePct} onChange={(event) => onRobustScenarioSettingsChange({ quantilePct: Math.max(0, Math.min(50, Number(event.target.value) || 0)) })} /> <span>%</span></label>
            </div>
            <p>Changer ces réglages change les simulations. Pour appliquer les nouveaux poids proposés, clique de nouveau sur « Robustesse ».</p>
          </details>
        </div>}
        <div className="growth-constraints" aria-label="Contraintes du profil Croissance">
          <div className="growth-constraints-heading"><span>Contraintes de recherche</span><small>Les valeurs sont modifiables et ne constituent pas des normes universelles.</small></div>
          <label>Plafond par actif <input aria-label="Plafond de poids par actif" type="number" min="0" max="100" step="1" value={growthConstraints.maxWeightPct} onChange={(event) => onGrowthConstraintsChange({ maxWeightPct: Math.max(0, Math.min(100, Number(event.target.value))) })} /> <span>%</span></label>
          <label><input aria-label="Activer le budget de drawdown annuel" type="checkbox" checked={growthConstraints.maxAnnualCloseDrawdownPct !== null} onChange={(event) => onGrowthConstraintsChange({ maxAnnualCloseDrawdownPct: event.target.checked ? 40 : null })} /> Drawdown maximal de clôture annuelle <input aria-label="Budget de drawdown annuel" type="number" min="0" max="100" step="1" value={growthConstraints.maxAnnualCloseDrawdownPct ?? ""} disabled={growthConstraints.maxAnnualCloseDrawdownPct === null} onChange={(event) => onGrowthConstraintsChange({ maxAnnualCloseDrawdownPct: Math.max(0, Math.min(100, Number(event.target.value))) })} /> <span>%</span></label>
          <label><input aria-label="Activer le budget de volatilité annuelle" type="checkbox" checked={growthConstraints.maxAnnualVolatilityPct !== null} onChange={(event) => onGrowthConstraintsChange({ maxAnnualVolatilityPct: event.target.checked ? 20 : null })} /> Volatilité annuelle maximale <input aria-label="Budget de volatilité annuelle" type="number" min="0" step="1" value={growthConstraints.maxAnnualVolatilityPct ?? ""} disabled={growthConstraints.maxAnnualVolatilityPct === null} onChange={(event) => onGrowthConstraintsChange({ maxAnnualVolatilityPct: Math.max(0, Number(event.target.value)) })} /> <span>%</span></label>
        </div>
         {growthOptimization.diagnostics.length > 0 && <p className="optimization-profile-note">{growthOptimization.diagnostics.join(" ")}</p>}
      </div>}
      <div className="weight-list">
        {assets.map((asset) => {
          const enteredWeight = weights[asset.id] ?? 0;
          return <div className="weight-row" key={asset.id}>
            <label className="weight-name" htmlFor={`weight-${asset.id}`}><i style={{ background: asset.accentColor }} />{asset.name}</label>
            <input id={`weight-${asset.id}`} type="number" min="0" max="100" step="0.1" value={Math.round(enteredWeight * 10) / 10} aria-label={`Poids saisi pour ${asset.name}`} onChange={(event) => onWeightChange(asset.id, Number(event.target.value))} />
            <span className="weight-percent">%</span>
            <input className="weight-slider" type="range" min="0" max="100" step="0.1" value={enteredWeight} aria-label={`Slider du poids saisi pour ${asset.name}`} onChange={(event) => onWeightChange(asset.id, Number(event.target.value))} />
            <div className="weight-breakdown"><span>Saisi <b>{enteredWeight.toFixed(1)} %</b></span><span>Normalisé <b>{normalizedWeights[asset.id].toFixed(1)} %</b></span><span>Utilisé <b>{enteredWeight > 0 ? normalizedWeights[asset.id].toFixed(1) : "0.0"} %</b></span></div>
          </div>;
        })}
      </div>
      <div className="allocation-bar" aria-label="Répartition normalisée des poids">
        {assets.filter((asset) => normalizedWeights[asset.id] > 0).map((asset) => <span key={asset.id} title={`${asset.name}: ${normalizedWeights[asset.id].toFixed(1)} %`} style={{ width: `${normalizedWeights[asset.id]}%`, background: asset.accentColor }} />)}
      </div>
      <div className="allocation-legend">{assets.filter((asset) => normalizedWeights[asset.id] > 0).map((asset) => <span key={asset.id}><i style={{ background: asset.accentColor }} />{asset.name} <b>{normalizedWeights[asset.id].toFixed(1)} %</b></span>)}</div>
      <div className={`weight-total ${Math.abs(totalWeight - 100) < 0.01 ? "valid" : "invalid"}`}>
        <span>Total saisi · simulation normalisée à 100 %</span><strong>{totalWeight.toFixed(1)} %</strong>
      </div>
      <button className="normalize-button" onClick={onNormalize}>Normaliser à 100 %</button>
      <p className="method-note">Simulation avec rééquilibrage annuel ; risque observé aux clôtures annuelles seulement. Frais, fiscalité et coûts de transaction non pris en compte. Les résultats décrivent un scénario historique, pas une prévision.</p>
    </section>

    {portfolio ? <>
       <section className="portfolio-summary">
         <div className="portfolio-kpi featured"><span>Rendement annualisé · {mode === "nominal" ? "nominal" : "réel"}</span><strong>{formatPercent(portfolio.cagr)}</strong><small>Performance moyenne par an, composée.</small></div>
         <Metric label="Volatilité" value={formatPercent(portfolio.volatility)} description="Variation annuelle des rendements." featured />
         <Metric label="Drawdown maximal" value={formatPercent(portfolio.maxDrawdown)} description="Plus forte baisse entre clôtures annuelles, depuis le capital initial ou un sommet annuel." negative featured />
           <Metric label="Rendement brut / volatilité" value={portfolio.grossReturnToVolatility === null ? "n.d." : portfolio.grossReturnToVolatility.toFixed(2)} description="Moyenne annuelle / volatilité, sans déduction du taux sans risque." tone={metricTone(portfolio.grossReturnToVolatility, "grossRatio")} />
           <Metric label="Corrélation entre actifs" value={weightedCorrelation === null ? "n.d." : weightedCorrelation.toFixed(2)} description="Moyenne pondérée hors diagonale, sur les mêmes années communes." tone={metricTone(weightedCorrelation, "correlation")} />
            <Metric label="Ratio de diversification" value={diversificationRatio === null ? "n.d." : diversificationRatio.toFixed(2)} description="Diagnostic statistique, sans seuil universel." tone={metricTone(diversificationRatio, "diversification")} />
           <Metric label="Années positives" value={`${portfolio.positiveRate.toFixed(0)} %`} description="Part des années au-dessus de 0 %." positive />
          <Metric label="Pire année" value={portfolio.worst ? `${portfolio.worst.year} · ${formatPercent(portfolio.worst.return)}` : "n.d."} description="Rendement annuel le plus faible." negative />
          <Metric label="Récupération" value={portfolio.recoveryYears === null ? "n.d." : `${portfolio.recoveryYears} an${portfolio.recoveryYears > 1 ? "s" : ""}`} description="Temps pour retrouver le précédent sommet." />
         </section>
         <PortfolioComparison portfolio={portfolio} equalPortfolio={equalPortfolio} mode={mode} />
         {currencyComparison && <CurrencyEffectCard portfolio={portfolio} comparison={currencyComparison} />}
         <section className="chart-card portfolio-chart">
           <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Trajectoire de l'allocation</h2><p>Valeur de 100 unités investies au début de la période.</p></div></div>
           <ResponsiveContainer width="100%" height={330}><LineChart data={trajectoryData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis scale="log" domain={["auto", "auto"]} {...axisProps} tickFormatter={formatMoney} /><Tooltip content={<PortfolioTooltip />} /><Line type="monotone" dataKey="value" name={currencyComparison ? "Valeur EUR" : "Valeur"} stroke="#e76f51" strokeWidth={2.5} dot={false} />{currencyComparison && <Line type="monotone" dataKey="usdValue" name="Valeur USD" stroke="#5e82a2" strokeWidth={2} dot={false} />}</LineChart></ResponsiveContainer><ChartMeta unit="Valeur de 100 unités · échelle logarithmique" source="Rendements annuels consolidés" period={`${portfolioData[0]?.year ?? "—"}–${portfolioData.at(-1)?.year ?? "—"}`} observations={portfolioData.length} />
         </section>
         <ContributionChart contributions={contributions} mode={mode} />
         <section className="chart-card drawdown-chart">
          <div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Drawdown dans le temps</h2><p>Écart entre la valeur du portefeuille et son plus-haut historique.</p></div></div>
          <ResponsiveContainer width="100%" height={260}><AreaChart data={drawdownData}><ChartGrid /><XAxis dataKey="year" {...axisProps} /><YAxis {...axisProps} tickFormatter={(value) => `${value}%`} /><Tooltip content={<DrawdownTooltip hasCurrencyComparison={Boolean(currencyComparison)} />} /><ReferenceLine y={0} stroke="#18324a" /><Area type="monotone" dataKey="drawdown" name={currencyComparison ? "Drawdown EUR" : "Drawdown"} stroke="#cf5b55" fill="#cf5b55" fillOpacity={0.14} />{currencyComparison && <Line type="monotone" dataKey="usdDrawdown" name="Drawdown USD" stroke="#5e82a2" strokeWidth={2} dot={false} />}</AreaChart></ResponsiveContainer><ChartMeta unit="Écart au plus-haut · %" source="Simulation du portefeuille" period={`${portfolioData[0]?.year ?? "—"}–${portfolioData.at(-1)?.year ?? "—"}`} observations={portfolioData.length} />
       </section>
       <HistoricalTable assets={assets} data={data} phases={phases} mode={mode} />
       <section className="table-card correlation-card">
        <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Corrélations entre actifs</h2><p>Corrélations des rendements {mode === "nominal" ? "nominaux" : "réels"} sur la période commune.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Actif</th>{assets.map((asset) => <th key={asset.id} style={{ color: asset.accentColor }}>{asset.name}</th>)}</tr></thead><tbody>{assets.map((asset) => <tr key={asset.id}><td>{asset.name}</td>{assets.map((other) => { const value = correlations[asset.id]?.[other.id]; return <td key={other.id} className={value === null ? "" : value < 0.3 ? "positive" : value > 0.7 ? "negative" : ""}>{value === null ? "n.d." : value.toFixed(2)}</td>; })}</tr>)}</tbody></table></div>
      </section>
      <section className="table-card portfolio-table">
        <div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Années difficiles</h2><p>Les cinq baisses annuelles les plus importantes du portefeuille.</p></div></div>
        <div className="table-scroll"><table><thead><tr><th>Année</th><th>Rendement</th><th>Valeur cumulée</th><th>Drawdown</th></tr></thead><tbody>{[...portfolioData].sort((a, b) => a.return - b.return).slice(0, 5).map((point) => <tr key={point.year}><td>{point.year}</td><td className={point.return >= 0 ? "positive" : "negative"}>{formatPercent(point.return)}</td><td>{formatNumber(point.value, 1)}</td><td className="negative">{formatPercent(point.drawdown)}</td></tr>)}</tbody></table></div>
      </section>
    </> : <div className="error-panel portfolio-empty">Données insuffisantes ou incohérentes : vérifie les pondérations et les rendements de chaque année de la période. Aucun rendement manquant n’est remplacé par zéro.</div>}
    </div>}
    {space === "comparison" && <PortfolioComparisonDashboard assets={assets} weights={weights} portfolio={portfolio} equalPortfolio={equalPortfolio} benchmarkPortfolio={benchmarkPortfolio} growthOptimization={growthProposal} robustOptimization={robustProposal} goalOptimization={goalProposal} mode={mode} />}
    {space === "validation" && <WalkForwardView assets={assets} result={walkForward} settings={validationSettings} robustScenarioSettings={robustScenarioSettings} onSettingsChange={onValidationSettingsChange} />}
  </div>;
}

function PortfolioComparison({ portfolio, equalPortfolio, mode }: { portfolio: PortfolioStats; equalPortfolio: PortfolioStats | null; mode: Mode }) {
  const delta = (current: number | null, equal: number | null) => current !== null && equal !== null ? formatPercent(current - equal, 1) : "n.d.";
  return <section className="portfolio-comparison">
    <div className="card-heading compact"><div className="heading-icon warm"><BarChart3 size={17} /></div><div><h2>Allocation active vs équipondérée</h2><p>Repère simple pour situer l'effet des pondérations choisies.</p></div></div>
    <div className="comparison-grid">
      <div className="comparison-card active"><span>Allocation active</span><strong>{formatPercent(portfolio.cagr)}</strong><small>Volatilité {formatPercent(portfolio.volatility)} · drawdown {formatPercent(portfolio.maxDrawdown)}</small></div>
      <div className="comparison-card"><span>Équipondérée</span><strong>{equalPortfolio ? formatPercent(equalPortfolio.cagr) : "n.d."}</strong><small>{equalPortfolio ? `Volatilité ${formatPercent(equalPortfolio.volatility)} · drawdown ${formatPercent(equalPortfolio.maxDrawdown)}` : "Données insuffisantes"}</small></div>
      <div className="comparison-delta"><span>Écart de rendement annualisé</span><strong>{delta(portfolio.cagr, equalPortfolio?.cagr ?? null)}</strong><small>Lecture {mode === "nominal" ? "nominale" : "réelle"}</small></div>
    </div>
  </section>;
}

function allocationLabel(assets: Asset[], weights: Record<string, number> | null): string {
  if (!weights) return "n.d.";
  const normalized = normalizeAllocationWeights(weights);
  if (!normalized) return "n.d.";
  const entries = assets
    .map(asset => ({ asset, weight: (normalized[asset.id] ?? 0) * 100 }))
    .filter(entry => entry.weight > 0)
    .sort((left, right) => right.weight - left.weight);
  return entries.length ? entries.map(entry => `${entry.asset.name} ${entry.weight.toFixed(0)} %`).join(" · ") : "n.d.";
}

function PortfolioComparisonDashboard({
  assets,
  weights,
  portfolio,
  equalPortfolio,
  benchmarkPortfolio,
  growthOptimization,
  robustOptimization,
  goalOptimization,
  mode,
}: {
  assets: Asset[];
  weights: Record<string, number>;
  portfolio: PortfolioStats | null;
  equalPortfolio: PortfolioStats | null;
  benchmarkPortfolio: PortfolioStats | null;
  growthOptimization: OptimizationResult;
  robustOptimization: OptimizationResult;
  goalOptimization: OptimizationResult;
  mode: Mode;
}) {
  const rows: Array<{ label: string; type: string; weights: Record<string, number> | null; stats: PortfolioStats | null; note?: string }> = [
    { label: "Croissance", type: "Automatique · in-sample", weights: growthOptimization.weights, stats: growthOptimization.stats, note: "Optimisée sur toute la période affichée." },
    { label: "Robustesse", type: "Automatique · scénario", weights: robustOptimization.weights, stats: robustOptimization.stats, note: robustOptimization.scenarioSummary ? `Quantile ${robustOptimization.scenarioSummary.quantilePct} % · ${robustOptimization.scenarioSummary.scenarioCount} scénarios` : "Scénarios indisponibles." },
    { label: "Personnalisée", type: "Poids fixes · in-sample", weights, stats: portfolio, note: "Pondérations modifiables dans Construction." },
    { label: "Équipondérée", type: "Référence · in-sample", weights: Object.fromEntries(assets.map(asset => [asset.id, 1])), stats: equalPortfolio },
    { label: "MSCI World", type: "Benchmark · in-sample", weights: { msci_world: 1 }, stats: benchmarkPortfolio, note: benchmarkPortfolio ? "Série indépendante si disponible." : "Non comparable sur cette période." },
    { label: "Objectif patrimonial", type: "Automatique · simulation", weights: goalOptimization.weights, stats: goalOptimization.stats, note: goalOptimization.goalSummary ? `Cible atteinte dans ${goalOptimization.goalSummary.probabilityPct.toFixed(1)} % des scénarios ; capital médian ${formatMoney(goalOptimization.goalSummary.medianCapital)}` : "Simulation indisponible." },
  ];

  return <div className="portfolio-space-content">
    <section className="table-card comparison-dashboard">
      <div className="card-heading compact"><div className="heading-icon warm"><BarChart3 size={17} /></div><div><h2>Comparer les allocations</h2><p>Résultats historiques sur la même période, devise, lecture et règles de rééquilibrage. Le hors échantillon est séparé dans Validation.</p></div></div>
       <div className="table-scroll"><table><thead><tr><th>Allocation</th><th>Nature</th><th>TCAM historique</th><th>Score scénario</th><th>Volatilité</th><th>Drawdown annuel</th><th>Pondérations</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.type}{row.note && <small className="table-note">{row.note}</small>}</td><td>{formatPercent(row.stats?.cagr)}</td><td>{row.label === "Robustesse" ? formatPercent(robustOptimization.scenarioSummary?.quantileCagr) : row.label === "Objectif patrimonial" ? goalOptimization.goalSummary ? `${goalOptimization.goalSummary.probabilityPct.toFixed(1)} % de réussite` : "n.d." : "n.a."}</td><td>{formatPercent(row.stats?.volatility)}</td><td>{formatPercent(row.stats?.maxDrawdown)}</td><td>{row.label === "MSCI World" ? row.stats ? "100 % MSCI World" : "n.d." : allocationLabel(assets, row.weights)}</td></tr>)}</tbody></table></div>
    </section>
    <section className="insight-card comparison-reading">
      <div className="card-heading compact"><div className="heading-icon cool"><CircleHelp size={17} /></div><div><h2>Lire cette comparaison</h2><p>Une bonne performance historique ne constitue pas une prévision.</p></div></div>
      <p>Les lignes in-sample décrivent les rendements observés sur la période complète. La validation walk-forward gèle les poids à chaque date de décision et mesure uniquement les années qui suivent, avec un CAGR composé hors échantillon. Les coûts, la fiscalité et les drawdowns intra-annuels ne sont pas modélisés.</p>
      {mode === "real" && <p className="method-note">La lecture réelle retire l'inflation française selon la convention documentée ; elle reste distincte d'un objectif nominal.</p>}
    </section>
  </div>;
}

function walkForwardWeights(assets: Asset[], weights: Record<string, number> | null): string {
  if (!weights) return "Échec";
  const entries = assets.map(asset => ({ asset, weight: (weights[asset.id] ?? 0) * 100 })).filter(entry => entry.weight > 0).sort((left, right) => right.weight - left.weight);
  return entries.length ? entries.slice(0, 3).map(entry => `${entry.asset.name} ${entry.weight.toFixed(0)} %`).join(" · ") : "0 %";
}

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className={`info-tip ${open ? "open" : ""}`}>
    <button type="button" className="info-button" aria-label={label} aria-expanded={open} onClick={() => setOpen(current => !current)}><Info size={14} /></button>
    <span className="info-popover" role="tooltip">{children}</span>
  </span>;
}

function WeightStabilityCell({ strategy }: { strategy: WalkForwardResult["strategies"][number] }) {
  if (strategy.id !== "growth" && strategy.id !== "robust" && strategy.id !== "goal") return <span className="fixed-weight-label">Poids fixes</span>;
  const label = weightStabilityLabel(strategy.weightStabilityPct);
  if (!label) return <span>n.d.</span>;
  return <><strong className="stability-label">{label}</strong><small className="table-note">{strategy.weightStabilityPct!.toFixed(0)} % · rotation {strategy.averageTurnoverPct?.toFixed(1) ?? "n.d."} pts</small></>;
}

function WalkForwardView({
  assets,
  result,
  settings,
  robustScenarioSettings,
  onSettingsChange,
}: {
  assets: Asset[];
  result: WalkForwardResult;
  settings: WalkForwardSettings;
  robustScenarioSettings: ScenarioSettings;
  onSettingsChange: (next: Partial<WalkForwardSettings>) => void;
}) {
  return <div className="validation-layout">
    <section className="validation-controls-card">
      <div className="card-heading compact"><div className="heading-icon cool"><CalendarDays size={17} /></div><div><h2>Validation walk-forward</h2><p>Les allocations sont apprises avant chaque test, puis gelées sur des rendements annuels hors échantillon.</p></div></div>
      <div className="validation-controls">
        <label>Apprentissage minimal <input aria-label="Années d'apprentissage" type="number" min="1" max="100" step="1" value={settings.minTrainYears} onChange={event => onSettingsChange({ minTrainYears: Math.max(1, Number(event.target.value) || 1) })} /> <span>ans</span></label>
        <label>Test par fenêtre <input aria-label="Années de test" type="number" min="1" max="30" step="1" value={settings.testYears} onChange={event => onSettingsChange({ testYears: Math.max(1, Number(event.target.value) || 1) })} /> <span>ans</span></label>
        <label className="validation-expanding"><input type="checkbox" checked={settings.expanding} disabled readOnly /> Apprentissage expansif</label>
      </div>
       <p className="method-note">Fenêtres de test non chevauchantes · rééquilibrage annuel vers les poids cibles · aucune donnée de test utilisée pour l'optimisation. L'apprentissage roulant sera ajouté ultérieurement.</p>
       <p className="method-note">Robustesse : {robustScenarioSettings.scenarioCount} scénarios · horizon {robustScenarioSettings.horizonYears} ans · blocs de {robustScenarioSettings.blockYears} an{robustScenarioSettings.blockYears > 1 ? "s" : ""} · graine {robustScenarioSettings.seed} · quantile {robustScenarioSettings.quantilePct} %. Ces hypothèses sont calibrées séparément dans chaque apprentissage.</p>
    </section>

    <section className="validation-summary-card">
      <div className="validation-summary-heading"><strong>{result.windows.length}</strong><span>fenêtre{result.windows.length > 1 ? "s" : ""} testée{result.windows.length > 1 ? "s" : ""}</span><small>incertitude {result.uncertainty}</small></div>
      {result.windows.length === 0 && <div className="configuration-message warning"><AlertTriangle size={16} /> Validation indisponible / insuffisante : il faut au moins une période complète d'apprentissage et de test.</div>}
      {result.diagnostics.map(diagnostic => <p className="optimization-profile-note" key={diagnostic}>{diagnostic}</p>)}
      {result.strategies.filter(strategy => !strategy.feasible).flatMap(strategy => strategy.diagnostics.map(diagnostic => <p className="optimization-profile-note" key={`${strategy.id}-${diagnostic}`}>{strategy.label} : {diagnostic}</p>))}
    </section>

    <section className="table-card validation-results-card">
      <div className="card-heading compact"><div className="heading-icon"><Activity size={17} /></div><div><h2>Résultats hors échantillon</h2><p>Le TCAM est composé sur les seules années de test ; il ne s'agit pas d'une moyenne de TCAM par fenêtre.</p></div></div>
       <div className="table-scroll"><table><thead><tr><th>Allocation</th><th>TCAM OOS <InfoTip label="Comprendre le TCAM OOS">OOS signifie « hors échantillon ». Les poids sont choisis sur l'apprentissage, puis testés uniquement sur les années suivantes. Le TCAM est composé sur ces années de test.</InfoTip></th><th>Volatilité</th><th>Drawdown annuel</th><th>Fenêtres valides</th><th>Stabilité des poids <InfoTip label="Comprendre la stabilité des poids">Pour Croissance, cet indicateur compare les pondérations recalculées entre les fenêtres. Robustesse utilise le même diagnostic entre ses fenêtres. Stable signifie que les recommandations changent peu ; variable ou instable signifie qu'elles dépendent davantage de la période historique. Personnalisée, Équipondérée et MSCI World ont des poids fixes.<br /><br /><strong>Légende :</strong> Très stable 80–100 % · Stable 60–79 % · Variable 40–59 % · Instable 20–39 % · Très instable 0–19 %.</InfoTip></th></tr></thead><tbody>{result.strategies.map(strategy => <tr key={strategy.id}><td>{strategy.label}</td><td>{strategy.feasible ? formatPercent(strategy.stats?.cagr) : "n.d."}</td><td>{strategy.feasible ? formatPercent(strategy.stats?.volatility) : "n.d."}</td><td>{strategy.feasible ? formatPercent(strategy.stats?.maxDrawdown) : "n.d."}</td><td>{strategy.validWindowCount} / {strategy.plannedWindowCount}</td><td><WeightStabilityCell strategy={strategy} /></td></tr>)}</tbody></table></div>
      <p className="method-note">Personnalisée signifie ici les poids choisis aujourd'hui, appliqués rétrospectivement. Ce test ne prétend pas représenter une sélection historiquement disponible.</p>
    </section>

    {result.windows.length > 0 && <section className="table-card validation-windows-card">
       <div className="card-heading compact"><div className="heading-icon warm"><SlidersHorizontal size={17} /></div><div><h2>Fenêtres et décisions</h2><p>Les poids de Croissance et Robustesse visibles dans chaque ligne proviennent uniquement de la période d'apprentissage correspondante.</p></div></div>
       <div className="table-scroll"><table><thead><tr><th>Fenêtre</th><th>Apprentissage</th><th>Test</th><th>Poids Croissance</th><th>Score TCAM</th><th>Poids Robustesse</th><th>Score quantile</th><th>Poids Objectif</th><th>Réussite simulée</th></tr></thead><tbody>{result.windows.map(window => { const growth = result.strategies.find(strategy => strategy.id === "growth")?.windows[window.index]; const robust = result.strategies.find(strategy => strategy.id === "robust")?.windows[window.index]; const goal = result.strategies.find(strategy => strategy.id === "goal")?.windows[window.index]; return <tr key={window.index}><td>{String(window.index + 1).padStart(2, "0")}</td><td>{window.trainStart}–{window.trainEnd}</td><td>{window.testStart}–{window.testEnd}</td><td>{walkForwardWeights(assets, growth?.weights ?? null)}</td><td>{growth?.score === null || growth?.score === undefined ? "n.d." : formatPercent(growth.score)}</td><td>{walkForwardWeights(assets, robust?.weights ?? null)}</td><td>{robust?.score === null || robust?.score === undefined ? "n.d." : formatPercent(robust.score)}</td><td>{walkForwardWeights(assets, goal?.weights ?? null)}</td><td>{goal?.score === null || goal?.score === undefined ? "n.d." : `${goal.score.toFixed(1)} %`}</td></tr>; })}</tbody></table></div>
    </section>}
  </div>;
}

function CurrencyEffectCard({ portfolio, comparison }: { portfolio: PortfolioStats; comparison: CurrencyComparison }) {
  const delta = portfolio.maxDrawdown - comparison.usd.maxDrawdown;
  const effect = delta < 0 ? "Le change a aggravé le drawdown" : delta > 0 ? "Le change a amorti le drawdown" : "Le change n'a pas modifié le drawdown";
  return <section className="portfolio-comparison currency-effect-card">
    <div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Effet du change sur le drawdown</h2><p>Comparaison avec le même portefeuille conservé en USD.</p></div></div>
    <div className="comparison-grid">
      <div className="comparison-card"><span>Référence USD</span><strong>{formatPercent(comparison.usd.maxDrawdown)}</strong><small>Drawdown maximal sans conversion EUR.</small></div>
      <div className="comparison-card active"><span>EUR non couvert</span><strong>{formatPercent(portfolio.maxDrawdown)}</strong><small>Lecture courante du portefeuille.</small></div>
      <div className="comparison-delta"><span>Écart lié à la devise</span><strong className={delta < 0 ? "negative" : "positive"}>{formatPercent(delta)}</strong><small>{effect}.</small></div>
    </div>
  </section>;
}

function ContributionChart({ contributions, mode }: { contributions: Array<{ asset: Asset; weight: number; contribution: number | null }>; mode: Mode }) {
  const sortedContributions = [...contributions].sort((left, right) => (right.contribution ?? -Infinity) - (left.contribution ?? -Infinity));
  const available = sortedContributions.filter((entry) => entry.contribution !== null);
  const scale = Math.max(0.1, ...available.map((entry) => Math.abs(entry.contribution as number)));
  const totalContribution = available.reduce((total, entry) => total + (entry.contribution as number), 0);
  const formatContributionShare = (contribution: number) => Math.abs(totalContribution) < Number.EPSILON ? "n.d." : `${(contribution / totalContribution * 100).toFixed(2).replace(".", ",")}%`;
  return <section className="contribution-card">
    <div className="card-heading compact"><div className="heading-icon cool"><Activity size={17} /></div><div><h2>Contribution au rendement</h2><p>Poids normalisé × TCAM individuel ; ces valeurs ne décomposent pas le TCAM du portefeuille.</p></div></div>
    <div className="contribution-list">{sortedContributions.map(({ asset, weight, contribution }) => <div className="contribution-row" key={asset.id}><div className="contribution-label"><i style={{ background: asset.accentColor }} /><span>{asset.name}</span><b>{weight.toFixed(1)} %</b></div><div className="contribution-track"><span className={contribution !== null && contribution < 0 ? "negative" : ""} style={{ width: `${contribution === null ? 0 : Math.max(4, Math.abs(contribution) / scale * 100)}%`, background: asset.accentColor }} /></div><strong>{contribution === null ? "n.d." : `${contribution >= 0 ? "+" : ""}${contribution.toFixed(2)} pts (${formatContributionShare(contribution)})`}</strong></div>)}</div>
    <p className="method-note">Cette lecture est un diagnostic pondéré des TCAM {mode === "nominal" ? "nominaux" : "réels"} individuels, pas une attribution additive ni une prévision.</p>
  </section>;
}

function ChartMeta({ unit, source, period, observations }: ChartMetadata) {
  return <div className="chart-metadata"><span>Unité <b>{unit}</b></span><span>Source <b>{source}</b></span><span>Période <b>{period}</b></span><span>Observations <b>{observations}</b></span></div>;
}

function PortfolioTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((entry) => <div key={entry.name}><span>{entry.name ?? "Valeur"}</span><b>{formatNumber(entry.value, 1)}</b></div>)}</div>;
}

function DrawdownTooltip({ active, payload, label, hasCurrencyComparison }: { active?: boolean; payload?: Array<{ name?: string; value?: number | null; dataKey?: string; payload?: CurrencyComparisonPoint & { drawdown: number } }>; label?: string | number; hasCurrencyComparison?: boolean }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  if (!hasCurrencyComparison || point?.usdDrawdown === undefined || point?.usdDrawdown === null) return <div className="chart-tooltip"><strong>{label}</strong><div><span>Drawdown</span><b>{formatPercent(payload[0].value)}</b></div></div>;
  const drawdownGap = point.currentDrawdown - point.usdDrawdown;
  return <div className="chart-tooltip"><strong>{label}</strong><div><span>Drawdown EUR</span><b>{formatPercent(point.currentDrawdown)}</b></div><div><span>Drawdown USD</span><b>{formatPercent(point.usdDrawdown)}</b></div><div><span>Écart de drawdown</span><b>{formatPercent(drawdownGap)}</b></div><div><span>Rendement EUR</span><b>{formatPercent(point.currentReturn)}</b></div><div><span>Rendement USD</span><b>{formatPercent(point.usdReturn)}</b></div><div><span>Change USD/EUR</span><b>{formatPercent(point.fxReturn)}</b></div></div>;
}

function ChartTooltip({ active, payload, label, assets, type }: { active?: boolean; payload?: Array<{ dataKey?: string; value?: number | null }>; label?: string | number; assets: Asset[]; type: "percent" | "money" | "number" }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => { const asset = assets.find((candidate) => candidate.id === item.dataKey); const value = item.value; return <div key={item.dataKey} style={{ color: asset?.accentColor }}><span>{asset?.name ?? item.dataKey}</span><b>{type === "percent" ? formatPercent(value) : type === "money" ? formatMoney(value ?? 0) : formatNumber(value)}</b></div>; })}</div>;
}

function exportChartData(data: ChartRow[], columns: ChartColumn[], title: string) {
  const escapeCell = (value: number | string | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = [columns.map((column) => escapeCell(column.label)).join(","), ...data.map((row) => columns.map((column) => escapeCell(row[column.key])).join(","))].join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "donnees"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function ChartCard({ title, subtitle, icon, children, data, columns, format = "number", legend, metadata }: { title: string; subtitle: string; icon: React.ReactNode; children: React.ReactNode; data?: ChartRow[]; columns?: ChartColumn[]; format?: "percent" | "money" | "number"; legend?: React.ReactNode; metadata?: ChartMetadata }) {
  const formatCell = (value: number | string | null) => {
    if (value === null || typeof value === "string") return value ?? "n.d.";
    if (format === "percent") return formatPercent(value);
    if (format === "money") return formatMoney(value);
    return formatNumber(value);
  };

  return <section className="chart-card"><div className="card-heading"><div className="heading-icon">{icon}</div><div><h2>{title}</h2><p>{subtitle}</p></div><div className="chart-actions"><button className="icon-button" title="Exporter les données CSV" aria-label="Exporter les données CSV" onClick={() => data && columns && exportChartData(data, columns, title)} disabled={!data || !columns}><Download size={16} /></button></div></div><div className="chart-wrap">{children}</div>{legend && <div className="chart-legend">{legend}</div>}{metadata && <div className="chart-metadata"><span>Unité <b>{metadata.unit}</b></span><span>Source <b>{metadata.source}</b></span><span>Période <b>{metadata.period}</b></span><span>Observations <b>{metadata.observations}</b></span></div>}{data && columns && <details className="chart-data"><summary>Voir les données du graphique</summary><div className="table-scroll"><table><caption>{title} · données tabulaires</caption><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{data.map((row, index) => <tr key={`${String(row[columns[0].key])}-${index}`}>{columns.map((column) => <td key={column.key}>{formatCell(row[column.key])}</td>)}</tr>)}</tbody></table></div></details>}</section>;
}

function Overview({ assets, stats, mode, start, end }: { assets: Asset[]; stats: Record<string, ReturnType<typeof computeStats>>; mode: Mode; start: number; end: number }) {
  return <>
     <section className="kpi-grid">{assets.map((asset) => { const stat = stats[asset.id]; if (!stat) return null; return <article className="asset-card" key={asset.id} style={{ "--asset-color": asset.accentColor } as React.CSSProperties}><div className="asset-card-top"><span className="asset-badge">{asset.name}</span><span className="asset-period">{start}–{end}</span></div><div className="main-kpi"><span>TCAM annualisé · {mode === "nominal" ? "nominal" : "réel"}</span><strong>{formatPercent(mode === "nominal" ? stat.cagrNominal : stat.cagrReal)}</strong><small>Performance moyenne par an, composée.</small></div><div className="metric-grid"><Metric label="Volatilité" value={formatPercent(stat.volatility, 1)} description="Variation annuelle des rendements." /><Metric label="Années positives" value={`${stat.positiveRate.toFixed(0)} %`} description="Part des années au-dessus de 0 %." /><Metric label="Meilleure année" value={stat.best ? `${stat.best.year} · ${formatPercent(returnValue(stat.best, mode))}` : "n.d."} description="Rendement annuel le plus élevé." positive /><Metric label="Pire année" value={stat.worst ? `${stat.worst.year} · ${formatPercent(returnValue(stat.worst, mode))}` : "n.d."} description="Rendement annuel le plus faible." negative /></div></article>; })}</section>
    <section className="insight-grid"><div className="insight-card"><div className="card-heading compact"><div className="heading-icon warm"><ArrowUpRight size={17} /></div><div><h2>Les meilleures années</h2><p>Top 5 · lecture {mode === "nominal" ? "nominale" : "réelle"}</p></div></div><RankingTable assets={assets} stats={stats} mode={mode} best /></div><div className="insight-card"><div className="card-heading compact"><div className="heading-icon cool"><ArrowDownRight size={17} /></div><div><h2>Les années difficiles</h2><p>Bottom 5 · lecture {mode === "nominal" ? "nominale" : "réelle"}</p></div></div><RankingTable assets={assets} stats={stats} mode={mode} best={false} /></div></section>
  </>;
}

function metricTone(value: number | null, kind: "grossRatio" | "correlation" | "diversification"): "very-negative" | "negative" | "neutral" | "positive" | "very-positive" | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  if (kind === "grossRatio") return value < 0 ? "very-negative" : value < 0.5 ? "negative" : value < 1 ? "neutral" : value < 2 ? "positive" : "very-positive";
  return undefined;
}

function Metric({ label, value, description, positive, negative, featured, tone }: { label: string; value: string; description: string; positive?: boolean; negative?: boolean; featured?: boolean; tone?: "very-negative" | "negative" | "neutral" | "positive" | "very-positive" }) { return <div className={`metric ${positive ? "positive" : negative ? "negative" : ""} ${tone ?? ""} ${featured ? "featured" : ""}`}><span>{label}</span><strong>{value}</strong><small>{description}</small></div>; }

function RankingTable({ assets, stats, mode, best }: { assets: Asset[]; stats: Record<string, ReturnType<typeof computeStats>>; mode: Mode; best: boolean }) { return <div className="ranking-table">{[0, 1, 2, 3, 4].map((index) => <div className="ranking-row" key={index}><span className="rank">0{index + 1}</span>{assets.map((asset) => { const row = (best ? stats[asset.id]?.best5 : stats[asset.id]?.worst5)?.[index]; return <div className="rank-asset" key={asset.id}><span>{asset.name}</span><strong style={{ color: asset.accentColor }}>{row ? `${row.year} · ${formatPercent(returnValue(row, mode))}` : "n.d."}</strong></div>; })}</div>)}</div>; }

function HistoricalTable({ assets, data, phases, mode }: { assets: Asset[]; data: Dataset; phases: typeof historicalPhases; mode: Mode }) {
  if (!phases.length) return null;
  return <section className="table-card"><div className="card-heading compact"><div className="heading-icon"><CalendarDays size={17} /></div><div><h2>Régimes historiques</h2><p>TCAM de chaque actif pendant les grandes séquences de marché</p></div></div><div className="table-scroll"><table><thead><tr><th>Période</th><th>Années</th>{assets.map((asset) => <th key={asset.id} style={{ color: asset.accentColor }}>{asset.name}</th>)}</tr></thead><tbody>{phases.map((phase) => <tr key={phase.name}><td><span className="phase-dot" style={{ background: phase.color }} />{phase.name}</td><td>{phase.start}–{phase.end}</td>{assets.map((asset) => { const stats = computeStats(data[asset.id], phase.start, phase.end, mode); const average = mode === "nominal" ? stats?.cagrNominal ?? null : stats?.cagrReal ?? null; return <td key={asset.id} className={average !== null && average >= 0 ? "positive" : "negative"}>{formatPercent(average)}</td>; })}</tr>)}</tbody></table></div></section>;
}

export default App;
