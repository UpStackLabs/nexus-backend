export interface LivePrice {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  source: 'polygon' | 'alpaca' | 'fmp' | 'seed';
  open?: number;
  high?: number;
  low?: number;
  previousClose?: number;
}
