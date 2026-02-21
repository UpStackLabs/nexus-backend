export interface LivePrice {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  source: 'finnhub' | 'polygon' | 'alpaca' | 'fmp' | 'seed';
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
