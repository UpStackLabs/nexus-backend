export interface ShockComponents {
  similarityScore: number;
  historicalSensitivity: number;
  geographicProximity: number;
  supplyChainLinkage: number;
}

export interface ShockAnalysisResult {
  compositeShockScore: number;
  predictedPriceChange: number;
  confidence: number;
  direction: 'up' | 'down';
  components: ShockComponents;
  surpriseFactor: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface RelevantEvent {
  eventId: string;
  title: string;
  type: string;
  severity: number;
  location: { lat: number; lng: number; country: string };
  timestamp: string;
  vectorSimilarity: number;
  description: string;
}

export interface StockAnalysis {
  ticker: string;
  companyName: string;
  sector: string;
  country: string;
  currentPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  relevantEvents: RelevantEvent[];
  shockAnalysis: ShockAnalysisResult;
  analyzedAt: string;
}

export interface PredictionPoint {
  date: string;
  price: number;
  upper: number;
  lower: number;
}

export interface ShockFactor {
  eventTitle: string;
  type: string;
  severity: number;
  impactScore: number;
  direction: 'up' | 'down';
}

export interface PredictionResult {
  ticker: string;
  companyName: string;
  currentPrice: number;
  trajectory: PredictionPoint[];
  shockFactors: ShockFactor[];
  aiSummary: string;
  confidence: number;
  generatedAt: string;
}
