export type ExecutionMode = "dry_run" | "live";
export type PositionStatus = "open" | "closed";

export interface PositionRow {
  id: number;
  candidate_id: number | null;
  mint: string;
  symbol: string | null;
  status: PositionStatus;
  opened_at_ms: number;
  closed_at_ms: number | null;
  size_sol: number;
  entry_price: number | null;
  entry_mcap: number | null;
  high_water_price: number | null;
  high_water_mcap: number | null;
  low_water_price: number | null;
  low_water_mcap: number | null;
  exit_price: number | null;
  exit_mcap: number | null;
  exit_reason: string | null;
  pnl_percent: number | null;
  pnl_sol: number | null;
  execution_mode: ExecutionMode;
  strategy_id: string;
  snapshot_json: string;
  llm_decision_id: number | null;
}

export interface TradeRow {
  id: number;
  position_id: number;
  mint: string;
  side: "buy" | "sell";
  at_ms: number;
  price: number | null;
  mcap: number | null;
  size_sol: number | null;
  token_amount_est: number | null;
  reason: string | null;
  payload_json: string;
}

export interface LlmDecisionRow {
  id: number;
  candidate_id: number;
  mint: string;
  created_at_ms: number;
  verdict: string;
  confidence: number;
  reason: string | null;
  risks_json: string;
  raw_json: string;
}

export interface Filters {
  from?: string;        // YYYY-MM-DD inclusive
  to?: string;          // YYYY-MM-DD inclusive
  lastN?: number;
  firstN?: number;
  strategy?: string;
  mode?: ExecutionMode | "both";
}
