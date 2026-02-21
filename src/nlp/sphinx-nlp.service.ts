import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

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

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
    if (!this.openai) {
      this.logger.warn('OPENAI_API_KEY not set — NLP will return stub values');
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.openai) {
      return new Array(1536).fill(0);
    }
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  async classifyEvent(rawText: string): Promise<ClassifiedEvent> {
    if (!this.openai) {
      return {
        type: 'geopolitical',
        severity: 5,
        location: 'Unknown',
        affectedCountries: [],
        affectedSectors: [],
        affectedTickers: [],
      };
    }
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
}
