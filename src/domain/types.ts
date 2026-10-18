export type Mode = "nominal" | "real";
export type Currency = "usd" | "eur";

export interface CurrencyContext {
  usdPerEur: Record<number, number>;
  frenchInflation: Record<number, number>;
}

export interface Asset {
  id: string;
  name: string;
  csvFile: string;
  accentColor: string;
  startYear: number;
  endYear: number;
}

export interface Row {
  /** Source first level has no return; preserved through currency conversion. */
  initialLevel?: boolean;
  year: number;
  price: number;
  cpi: number;
  nominal: number;
  inflation: number;
  real: number;
}

export interface Stats {
  count: number;
  cagrNominal: number | null;
  cagrReal: number | null;
  volatility: number;
  positiveRate: number;
  best: Row | null;
  worst: Row | null;
  best5: Row[];
  worst5: Row[];
}

export interface PortfolioPoint {
  year: number;
  return: number;
  value: number;
  drawdown: number;
}

export interface PortfolioStats {
  points: PortfolioPoint[];
  count: number;
  cagr: number | null;
  volatility: number;
  /** Arithmetic gross return / population volatility; no risk-free deduction. */
  grossReturnToVolatility: number | null;
  positiveRate: number;
  best: PortfolioPoint | null;
  worst: PortfolioPoint | null;
  maxDrawdown: number;
  recoveryYears: number | null;
}

export interface PortfolioCandidate {
  weights: Record<string, number>;
  stats: PortfolioStats;
  weightedCorrelation?: number | null;
  diversificationRatio?: number | null;
}

export type PortfolioOptimizationProfile = "growth";

export interface PortfolioOptimizationResults {
  returnCandidate: PortfolioCandidate | null;
  minimumDrawdownCandidate: PortfolioCandidate | null;
  moderateDiversificationCandidate: PortfolioCandidate | null;
  strongDiversificationCandidate: PortfolioCandidate | null;
}

export interface PortfolioWindow {
  start: number;
  end: number;
}

export interface CorrelationCell {
  value: number | null;
  observations: number;
}
