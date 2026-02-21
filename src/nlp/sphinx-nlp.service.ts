import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import axios from 'axios';

export interface ClassifiedEvent {
  type: string;
  severity: number;
  location: string;
  affectedCountries: string[];
  affectedSectors: string[];
  affectedTickers: string[];
}

@Injectable()
export class SphinxNlpService {
  private readonly logger = new Logger(SphinxNlpService.name);
  private readonly openai: OpenAI | null;
  private readonly modelServerUrl: string | undefined;
  private modelServerReachable = false;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey, timeout: 15_000 }) : null;
    this.modelServerUrl = this.config.get<string>('MODEL_SERVER_URL');

    if (this.modelServerUrl) {
      this.checkModelServer();
    } else if (!this.openai) {
      this.logger.warn(
        'Neither MODEL_SERVER_URL nor OPENAI_API_KEY set — NLP will return stub values',
      );
    }
  }

  private async checkModelServer(): Promise<void> {
    try {
      await axios.get(`${this.modelServerUrl}/health`, { timeout: 3000 });
      this.modelServerReachable = true;
      this.logger.log(
        `Custom model server reachable at ${this.modelServerUrl}`,
      );
    } catch {
      this.logger.warn(
        `Custom model server unreachable at ${this.modelServerUrl} — will fallback to OpenAI or stubs`,
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    // Try custom model server first (384-dim MiniLM embeddings)
    if (this.modelServerReachable) {
      try {
        const res = await axios.post<{ embedding: number[] }>(
          `${this.modelServerUrl}/embed`,
          { text },
          { timeout: 10_000 },
        );
        return res.data.embedding;
      } catch {
        this.logger.warn('Custom embed failed, trying OpenAI fallback');
      }
    }

    // Fallback to OpenAI (1536-dim embeddings)
    if (this.openai) {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    }

    // Stub: return zero vector (384-dim to match MiniLM)
    return new Array(384).fill(0);
  }

  async classifyEvent(rawText: string): Promise<ClassifiedEvent> {
    // Try custom model server first
    if (this.modelServerReachable) {
      try {
        const res = await axios.post<ClassifiedEvent>(
          `${this.modelServerUrl}/classify`,
          { text: rawText },
          { timeout: 10_000 },
        );
        return res.data;
      } catch {
        this.logger.warn('Custom classify failed, trying OpenAI fallback');
      }
    }

    // Fallback to OpenAI
    if (this.openai) {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a financial news analyst. Extract structured information from news articles and return JSON with exactly these fields:
{
  "type": one of ["military","economic","policy","natural_disaster","geopolitical"],
  "severity": integer 1-10,
  "location": "city, country string",
  "affectedCountries": ["ISO2 code", ...],
  "affectedSectors": ["sector name", ...],
  "affectedTickers": ["TICKER", ...]
}`,
          },
          {
            role: 'user',
            content: rawText,
          },
        ],
      });
      const content = response.choices[0].message.content ?? '{}';
      return JSON.parse(content) as ClassifiedEvent;
    }

    // Stub response
    return {
      type: 'geopolitical',
      severity: 5,
      location: 'Unknown',
      affectedCountries: [],
      affectedSectors: [],
      affectedTickers: [],
    };
  }

  async generateText(prompt: string): Promise<string> {
    if (this.openai) {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
      });
      return response.choices[0].message.content ?? '';
    }

    // No OpenAI key — return empty to trigger caller's fallback
    throw new Error('No LLM provider available');
  }

  /** Predict shock impact using custom model server */
  async predictShock(features: {
    severity: number;
    eventType: string;
    sectorRelevance: number;
    geographicProximity: number;
  }): Promise<{ predictedChange: number; confidence: number }> {
    if (this.modelServerReachable) {
      try {
        const res = await axios.post<{
          predicted_change: number;
          confidence: number;
        }>(
          `${this.modelServerUrl}/predict-shock`,
          {
            features: {
              severity: features.severity,
              event_type: features.eventType,
              sector_relevance: features.sectorRelevance,
              geographic_proximity: features.geographicProximity,
            },
          },
          { timeout: 5_000 },
        );
        return {
          predictedChange: res.data.predicted_change,
          confidence: res.data.confidence,
        };
      } catch {
        this.logger.debug('Shock prediction failed, using heuristic');
      }
    }

    // Heuristic fallback
    const magnitude =
      features.severity *
      0.3 *
      features.sectorRelevance *
      (0.5 + 0.5 * features.geographicProximity);
    return {
      predictedChange: -magnitude,
      confidence: 0.6 + 0.1 * features.sectorRelevance,
    };
  }
}
