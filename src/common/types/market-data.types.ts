export interface LivePrice {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  source: 'polygon' | 'alpaca' | 'fmp' | 'seed';
}

export interface MarketQuote {
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string;
}
