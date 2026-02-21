export interface Stock {
  ticker: string;
  companyName: string;
  sector: string;
  country: string;
  exchange: string;
  marketCap: number;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  location: {
    lat: number;
    lng: number;
  };
}

export interface StockWithShockHistory extends Stock {
  shockHistory: StockShockEntry[];
}

export interface StockShockEntry {
  eventId: string;
  eventTitle: string;
  shockScore: number;
  predictedChange: number;
  actualChange: number;
  surpriseFactor: number;
  timestamp: string;
}

export interface SurpriseAnalysis {
  ticker: string;
  companyName: string;
  currentSurpriseFactor: number;
  historicalAvgSurprise: number;
  isAnomaly: boolean; // surprise > 2σ
  recentSurprises: SurpriseEntry[];
}

export interface SurpriseEntry {
  eventId: string;
  eventTitle: string;
  predictedChange: number;
  actualChange: number;
  surpriseFactor: number;
  timestamp: string;
}
