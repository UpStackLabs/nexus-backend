export interface ShockScore {
  eventId: string;
  ticker: string;
  companyName: string;
  sector: string;
  country: string;
  /** Composite shock score S(c,e) */
  score: number;
  /** Component: cosine similarity between event and company embeddings */
  similarityScore: number;
  /** Component: historical sensitivity */
  historicalSensitivity: number;
  /** Component: geographic proximity factor */
  geographicProximity: number;
  /** Component: supply chain linkage */
  supplyChainLinkage: number;
  /** Predicted price change percentage */
  predictedChange: number;
  /** Actual price change percentage (null if not yet observed) */
  actualChange: number | null;
  /** Surprise factor: |actual - predicted| / σ */
  surpriseFactor: number | null;
  /** Model confidence 0-1 */
  confidence: number;
  direction: 'up' | 'down';
}

export interface ShockScoreWeights {
  alpha: number; // similarity weight
  beta: number; // historical sensitivity weight
  gamma: number; // geographic proximity weight
  delta: number; // supply chain weight
}

export interface InterlinkednessScore {
  eventId: string;
  score: number;
  affectedAssetCount: number;
  averagePairwiseCorrelation: number;
}
