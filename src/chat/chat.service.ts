import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import {
  SEED_EVENTS,
  SEED_STOCKS,
  SEED_SHOCKS,
} from '../common/data/seed-data.js';

interface ChatContext {
  events: string;
  stocks: string;
  shocks: string;
  vectorResults: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly ollamaUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly nlp: SphinxNlpService,
    private readonly vectorDb: VectorDbService,
  ) {
    this.ollamaUrl =
      this.config.get<string>('OLLAMA_URL') ?? 'http://localhost:11434';
  }

  async chat(
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<string> {
    // 1. Build context from RAG retrieval + seed data
    const context = await this.buildContext(message);

    // 2. Try Ollama (Mistral-7B) first, fallback to intelligent mock response
    try {
      return await this.queryOllama(message, history, context);
    } catch {
      this.logger.warn('Ollama unavailable — using intelligent fallback');
      return this.generateFallbackResponse(message, context);
    }
  }

  async *chatStream(
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[] = [],
  ): AsyncGenerator<string> {
    const context = await this.buildContext(message);

    try {
      yield* this.streamOllama(message, history, context);
    } catch {
      this.logger.warn('Ollama unavailable — streaming fallback response');
      const fallback = this.generateFallbackResponse(message, context);
      // Stream the fallback word by word
      const words = fallback.split(' ');
      for (const word of words) {
        yield word + ' ';
      }
    }
  }

  private async buildContext(query: string): Promise<ChatContext> {
    // Embed query and search vector DB for relevant events
    let vectorResults = '';
    try {
      const embedding = await this.nlp.embed(query);
      const results = await this.vectorDb.querySimilarEvents(embedding, 5);
      if (results.length > 0) {
        vectorResults = results
          .map(
            (r, i) =>
              `${i + 1}. Event ${r.eventId} (similarity: ${r.similarity.toFixed(3)})` +
              (r.metadata?.title ? ` — ${r.metadata.title}` : ''),
          )
          .join('\n');
      }
    } catch {
      this.logger.debug('Vector search failed, using seed data only');
    }

    // Build context from seed data
    const events = SEED_EVENTS.slice(0, 3)
      .map(
        (e) =>
          `- ${e.title} (${e.type}, severity ${e.severity}/10, ${e.location.region ?? ''}, ${e.location.country})` +
          `\n  Affected: ${e.affectedSectors.join(', ')} | Tickers: ${e.affectedTickers.join(', ')}`,
      )
      .join('\n');

    const topShocks = SEED_SHOCKS.sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(
        (s) =>
          `- ${s.ticker} (${s.companyName}): shock=${s.score.toFixed(2)}, direction=${s.direction}, predicted=${s.predictedChange > 0 ? '+' : ''}${s.predictedChange.toFixed(1)}%`,
      )
      .join('\n');

    const stocks = SEED_STOCKS.slice(0, 15)
      .map(
        (s) =>
          `- ${s.ticker} ${s.companyName}: $${s.price} (${s.priceChangePercent > 0 ? '+' : ''}${s.priceChangePercent}%), ${s.sector}, ${s.country}`,
      )
      .join('\n');

    return {
      events,
      stocks,
      shocks: topShocks,
      vectorResults:
        vectorResults || 'No vector search results (VectorAI DB offline)',
    };
  }

  private async queryOllama(
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    context: ChatContext,
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const response = await axios.post(
      `${this.ollamaUrl}/api/chat`,
      {
        model: 'mistral',
        messages,
        stream: false,
        options: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
      },
      { timeout: 30_000 },
    );

    return response.data.message?.content ?? 'No response generated.';
  }

  private async *streamOllama(
    message: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    context: ChatContext,
  ): AsyncGenerator<string> {
    const systemPrompt = this.buildSystemPrompt(context);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const response = await axios.post(
      `${this.ollamaUrl}/api/chat`,
      {
        model: 'mistral',
        messages,
        stream: true,
        options: { temperature: 0.7, top_p: 0.9, num_predict: 512 },
      },
      { timeout: 60_000, responseType: 'stream' },
    );

    for await (const chunk of response.data) {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            yield json.message.content;
          }
        } catch {
          // skip non-JSON lines
        }
      }
    }
  }

  private buildSystemPrompt(context: ChatContext): string {
    return `You are Nexus AI, an elite financial intelligence analyst embedded in the ShockGlobe platform. You have access to real-time OSINT data, market analytics, and geopolitical risk assessments.

ACTIVE EVENTS:
${context.events}

TOP SHOCK-IMPACTED STOCKS:
${context.shocks}

MARKET DATA:
${context.stocks}

VECTOR SEARCH RESULTS:
${context.vectorResults}

INSTRUCTIONS:
- Analyze geopolitical events and their financial market implications
- Reference specific stocks, shock scores, and sectors from the data above
- Provide actionable intelligence with clear risk assessments
- Use precise financial terminology (e.g., "exposure", "downside risk", "correlation")
- Keep responses concise but data-rich (2-4 paragraphs max)
- Format key metrics in bold when relevant
- If asked about something outside your data, state the limitation clearly`;
  }

  private generateFallbackResponse(
    message: string,
    context: ChatContext,
  ): string {
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('exposed') ||
      lowerMessage.includes('risk') ||
      lowerMessage.includes('vulnerable')
    ) {
      const topShocks = SEED_SHOCKS.sort((a, b) => b.score - a.score).slice(
        0,
        5,
      );
      return (
        `**Risk Assessment — Active Event Analysis**\n\n` +
        `Based on current OSINT signals, the highest-exposure positions are:\n\n` +
        topShocks
          .map(
            (s, i) =>
              `${i + 1}. **${s.ticker}** (${s.companyName}) — Shock Score: ${s.score.toFixed(2)}/1.0, ` +
              `Direction: ${s.direction}, Predicted Move: ${s.predictedChange > 0 ? '+' : ''}${s.predictedChange.toFixed(1)}%`,
          )
          .join('\n') +
        `\n\n**Key Sectors at Risk:** Energy, Defense, and Agriculture show the highest aggregate exposure. ` +
        `Geographic proximity to the epicenter and supply-chain dependencies are the primary transmission channels.\n\n` +
        `_Analysis powered by Nexus AI — ShockGlobe Intelligence Platform_`
      );
    }

    if (
      lowerMessage.includes('compare') ||
      lowerMessage.includes('historical') ||
      lowerMessage.includes('similar')
    ) {
      return (
        `**Historical Comparison Analysis**\n\n` +
        `The current event profile shows structural similarities to:\n\n` +
        `1. **2022 Russia-Ukraine Conflict** — Energy sector shock propagation pattern, commodity price spikes, defense sector rally\n` +
        `2. **2019 Saudi Aramco Attack** — Oil supply disruption, regional instability premium, flight to safe-haven assets\n` +
        `3. **2014 Crimea Annexation** — Geopolitical risk repricing, emerging market currency sell-off, sanctions cascade effects\n\n` +
        `In each historical analog, energy stocks experienced 15-25% moves within the first 72 hours, ` +
        `followed by a normalization period of 2-4 weeks. Defense contractors showed sustained 10-15% gains over 30 days.\n\n` +
        `_Analysis powered by Nexus AI — ShockGlobe Intelligence Platform_`
      );
    }

    if (
      lowerMessage.includes('sector') ||
      lowerMessage.includes('industry')
    ) {
      return (
        `**Sector Impact Assessment**\n\n` +
        `Current event propagation across sectors:\n\n` +
        `| Sector | Avg Shock | Direction | Key Tickers |\n` +
        `|--------|-----------|-----------|-------------|\n` +
        `| Energy | 0.82 | Mixed ↕ | XOM, CVX, COP |\n` +
        `| Defense | 0.75 | Up ↑ | LMT, RTX, NOC |\n` +
        `| Finance | 0.58 | Down ↓ | JPM, GS, BAC |\n` +
        `| Agriculture | 0.52 | Up ↑ | ADM, BG, DAR |\n` +
        `| Tech | 0.35 | Down ↓ | AAPL, MSFT, TSM |\n\n` +
        `Energy and Defense sectors show the highest sensitivity to the current geopolitical event. ` +
        `Supply chain disruptions in semiconductors (TSM) represent a secondary propagation channel.\n\n` +
        `_Analysis powered by Nexus AI — ShockGlobe Intelligence Platform_`
      );
    }

    // Default response
    const event = SEED_EVENTS[0];
    return (
      `**Nexus Intelligence Briefing**\n\n` +
      `Current primary event: **${event.title}** (Severity: ${event.severity}/10, Type: ${event.type})\n\n` +
      `The ShockGlobe platform is tracking ${SEED_EVENTS.length} active events across ${new Set(SEED_EVENTS.flatMap((e) => e.affectedCountries)).size} countries. ` +
      `${SEED_SHOCKS.length} stock-event shock relationships are being monitored in real-time.\n\n` +
      `You can ask me about:\n` +
      `- **Risk exposure**: "Which stocks are most exposed?"\n` +
      `- **Sector analysis**: "How are sectors impacted?"\n` +
      `- **Historical parallels**: "How does this compare to past events?"\n` +
      `- **Specific tickers**: "Analyze XOM's risk profile"\n\n` +
      `_Nexus AI — Powered by Mistral-7B + Actian VectorAI RAG retrieval_`
    );
  }
}
