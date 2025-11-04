export interface CandleDto {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GetCandlesQueryDto {
  timeframe: string;
  from?: Date;
  to?: Date;
  limit?: number;
}
