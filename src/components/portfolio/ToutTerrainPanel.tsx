import { useMemo } from "react";
import { CloudLightning, Flame, Globe2, TrendingUp } from "lucide-react";
import type { Asset, Mode, Row } from "../../domain/types";
import type { OptimizationResult } from "../../optimization/interface";
import type { ProspectiveSettings } from "../../scenarios/prospective";
import { defaultProspectiveSettings, generateProspectiveScenarios } from "../../scenarios/prospective";
import type { ScenarioSettings } from "../../scenarios/generator";
import { scenarioPortfolioCagr } from "../../scenarios/generator";
import { formatNumber, formatPercent } from "../../format";

type Props = {
  assets: Asset[];
  data: Record<string, Row[]>;
  start: number;
  end: number;
  mode: Mode;
  scenarioSettings: ScenarioSettings;
  onScenarioSettingsChange: (next: Partial<ScenarioSettings>) => void;
  settings: ProspectiveSettings;
  onSettingsChange: (next: ProspectiveSettings) => void;
  growth: OptimizationResult;
  terrain: OptimizationResult;
};

const FUTURE_ICONS = [TrendingUp, Globe2, Flame, CloudLightning];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function signedPoints(points: number): string {
  return `${points > 0 ? "+" : points < 0 ? "−" : ""}${formatNumber(Math.abs(points), 1)} point${Math.abs(points) >= 2 ? "s" : ""}/an`;
}

/** The two strategies are evaluated on precisely the same deterministic regime draws. */
export default function ToutTerrainPanel({ assets, data, start, end, mode, scenarioSettings, onScenarioSettingsChange, settings, onSettingsChange, growth, terrain }: Props) {
  const rows = useMemo(() => {
    if (!growth.weights || !terrain.weights || !terrain.prospectiveSummary || assets.length === 0) return null;
    const generated = generateProspectiveScenarios(
      { data, assetIds: assets.map(asset => asset.id), start, end, mode },
      { ...scenarioSettings, scenarioCount: settings.pathsPerRegime },
      settings,
    );
    if (generated.diagnostics.length || generated.sets.length !== settings.regimes.length) return null;
    const output = generated.sets.map((set) => {
      const values = set.scenarios.map(scenario => scenarioPortfolioCagr(scenario, growth.weights!));
      const terrainValue = terrain.prospectiveSummary!.regimeCagrs.find(regime => regime.id === set.regime.id)?.medianCagr;
      if (values.some(value => value === null || !Number.isFinite(value)) || terrainValue === undefined) return null;
      return {
        id: set.regime.id,
        name: set.regime.name,
        description: set.regime.description,
        growth: median(values as number[]),
        terrain: terrainValue,
      };
    });
    return output.some(row => row === null) ? null : output as Array<{ id: string; name: string; description: string; growth: number; terrain: number }>;
  }, [assets, data, start, end, mode, scenarioSettings, settings, growth.weights, terrain.weights, terrain.prospectiveSummary]);

  const victories = rows?.filter(row => row.terrain > row.growth + 1e-8).length ?? 0;
  const usScenario = rows?.find(row => row.id === "us-growth");
  const worstGrowth = rows ? Math.min(...rows.map(row => row.growth)) : null;
  const worstTerrain = rows ? Math.min(...rows.map(row => row.terrain)) : null;
  const historicalGap = growth.stats?.cagr != null && terrain.stats?.cagr != null ? terrain.stats.cagr - growth.stats.cagr : null;

  const updateRegime = (index: number, update: Partial<ProspectiveSettings["regimes"][number]>) => {
    onSettingsChange({
      ...settings,
      regimes: settings.regimes.map((regime, i) => i === index ? { ...regime, ...update } : regime),
    });
  };

  return <div className="terrain-panel">
    <header className="terrain-intro">
      <strong>Un portefeuille adapté à plusieurs futurs, pas seulement au meilleur.</strong>
      <p>Tout-terrain cherche une répartition qui limite le manque à gagner maximal par rapport à une allocation adaptée à chacun des quatre futurs. Cela ne veut pas dire qu'elle subira toujours moins de pertes que Croissance.</p>
    </header>

    <section className="terrain-section" aria-label="Quatre futurs économiques">
      <h3>1. Quatre futurs économiques à explorer</h3>
      <div className="terrain-futures">
        {settings.regimes.map((regime, index) => {
          const Icon = FUTURE_ICONS[index] ?? Globe2;
          return <article key={regime.id} className="terrain-future">
            <div className="terrain-future-title"><Icon size={18} aria-hidden="true" /><strong>{regime.name}</strong></div>
            <p>{regime.description}</p>
          </article>;
        })}
      </div>
      <p className="terrain-disclaimer">Ces futurs sont des hypothèses illustratives modifiables, pas des prévisions. Les écarts de rendement utilisés sont fixés par défaut, pas estimés scientifiquement.</p>
    </section>

    <section className="terrain-section" aria-label="Comparer Croissance et Tout-terrain">
      <h3>2. Croissance contre Tout-terrain</h3>
      <p>Rendement annuel médian simulé pour chaque futur, sur {scenarioSettings.horizonYears} ans. Les deux allocations sont testées sur exactement les mêmes tirages historiques.</p>
      {rows ? <div className="terrain-table-scroll">
        <table className="terrain-table">
          <thead><tr><th scope="col">Futur économique</th><th scope="col">Croissance</th><th scope="col">Tout-terrain</th><th scope="col">Écart</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}>
            <th scope="row">{row.name}</th>
            <td>{formatPercent(row.growth)}</td>
            <td className={row.terrain > row.growth ? "terrain-better" : ""}>{formatPercent(row.terrain)}</td>
            <td className={row.terrain > row.growth ? "terrain-better" : ""}>{signedPoints(row.terrain - row.growth)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p role="status" className="terrain-unavailable">Comparaison indisponible : vérifie les contraintes et les hypothèses ci-dessous.</p>}
    </section>

    {rows && <section className="terrain-section terrain-takeaway" aria-label="Compromis de l'allocation">
      <h3>3. Ce que tu gagnes — et ce que tu sacrifies</h3>
      <p><strong>Dans {victories} futur{victories > 1 ? "s" : ""} sur {rows.length},</strong> Tout-terrain obtient un meilleur rendement médian que Croissance. Ce bilan ne constitue pas une probabilité de réussite.</p>
      {usScenario && <p>Si les États-Unis continuent de dominer, l'écart serait de <strong>{signedPoints(usScenario.terrain - usScenario.growth)}</strong> pour Tout-terrain.</p>}
      {historicalGap !== null && <p>Sur l'historique observé, l'écart de rendement annualisé est de <strong>{signedPoints(historicalGap)}</strong> pour Tout-terrain par rapport à Croissance.</p>}
      <div className="terrain-table-scroll">
        <table className="terrain-table terrain-risk-table">
          <thead><tr><th scope="col">Autres repères</th><th scope="col">Croissance</th><th scope="col">Tout-terrain</th></tr></thead>
          <tbody>
            <tr><th scope="row">Volatilité historique</th><td>{formatPercent(growth.stats?.volatility)}</td><td>{formatPercent(terrain.stats?.volatility)}</td></tr>
            <tr><th scope="row">Drawdown maximal de clôture annuelle</th><td>{formatPercent(growth.stats?.maxDrawdown)}</td><td>{formatPercent(terrain.stats?.maxDrawdown)}</td></tr>
            <tr><th scope="row">Futur le plus défavorable testé</th><td>{formatPercent(worstGrowth)}</td><td>{formatPercent(worstTerrain)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="terrain-disclaimer">Le futur le plus défavorable est le plus faible des quatre rendements médians simulés pour chaque allocation ; ce n'est ni une perte maximale possible ni un stress test exhaustif. Le drawdown repose uniquement sur les clôtures annuelles historiques et ne mesure pas les baisses intra-annuelles.</p>
    </section>}

    {terrain.diagnostics.length > 0 && <div className="terrain-diagnostics" role="status">{terrain.diagnostics.map(message => <p key={message}>{message}</p>)}</div>}

    <details className="terrain-advanced">
      <summary>Paramètres avancés : horizon et hypothèses des quatre futurs</summary>
      <label className="terrain-paths-setting"><span>Horizon des scénarios économiques</span><input aria-label="Horizon des scénarios économiques" type="number" min="1" max="100" step="1" value={scenarioSettings.horizonYears} onChange={event => onScenarioSettingsChange({ horizonYears: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })}/> ans</label>
      <p>Chaque ajustement ajoute ou retire des points de rendement annuel à une série historique ; les fluctuations sont ensuite modifiées selon les paramètres du scénario. Les valeurs par défaut sont purement illustratives.</p>
      <div className="terrain-regime-settings">{settings.regimes.map((regime, index) => <fieldset key={regime.id}>
        <legend>{regime.name}</legend>
        <p>{regime.description}</p>
        {assets.map(asset => <label key={asset.id}>
          <span>{asset.name} — rendement annuel</span>
          <input aria-label={`Ajustement ${regime.name} ${asset.name}`} type="number" min="-100" max="100" step="0.5"
            value={regime.shiftsPct[asset.id] ?? 0}
            onChange={event => updateRegime(index, { shiftsPct: { ...regime.shiftsPct, [asset.id]: Number(event.target.value) } })}/>
          <small>points</small>
        </label>)}
        <label><span>Amplitude des variations</span>
          <input type="number" aria-label={`Variations ${regime.name}`} min="0" max="3" step="0.1"
            value={regime.volatilityMultiplier}
            onChange={event => updateRegime(index, { volatilityMultiplier: Number(event.target.value) })}/></label>
        <label><span>Choc commun aux actifs risqués</span>
          <input type="number" aria-label={`Choc commun ${regime.name}`} min="0" max="2" step="0.05"
            value={regime.equityShockMultiplier}
            onChange={event => updateRegime(index, { equityShockMultiplier: Number(event.target.value) })}/></label>
      </fieldset>)}</div>
      <label className="terrain-paths-setting"><span>Trajectoires simulées par futur</span>
        <input type="number" aria-label="Simulations par régime" min="1" max="500" value={settings.pathsPerRegime}
          onChange={event => onSettingsChange({ ...settings, pathsPerRegime: Math.min(500, Math.max(1, Number(event.target.value) || 1)) })}/>
      </label>
      <button type="button" className="terrain-reset" onClick={() => onSettingsChange(defaultProspectiveSettings())}>Rétablir les hypothèses illustratives</button>
    </details>
    <p className="terrain-disclaimer">Le portefeuille proposé est recalculé automatiquement lorsque les hypothèses changent. Frais, fiscalité et événements futurs inconnus ne sont pas modélisés.</p>
  </div>;
}
