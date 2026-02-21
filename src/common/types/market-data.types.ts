export interface LivePrice {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  source: 'yahoo' | 'finnhub' | 'polygon' | 'seed';
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
}

export interface HistoricalCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
