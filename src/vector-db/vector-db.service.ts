import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface VectorSearchResult {
  eventId: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

/**
 * Talks to the Actian VectorAI Python bridge (vectorai-bridge/main.py).
 * The bridge wraps actiancortex (gRPC) and exposes three REST endpoints:
 *   GET  /health
 *   POST /upsert   { event_id, embedding, metadata }
 *   POST /search   { embedding, top_k }
 *
 * Set ACTIAN_BRIDGE_URL=http://localhost:8001 in .env.
 * If the var is absent the service logs a warning and returns [] for all queries.
 */
@Injectable()
export class VectorDbService implements OnModuleInit {
  private readonly logger = new Logger(VectorDbService.name);
  private readonly bridgeUrl: string | undefined;
  private reachable = false;

  constructor(private readonly config: ConfigService) {
    this.bridgeUrl = this.config.get<string>('ACTIAN_BRIDGE_URL');
  }

  /** True only when bridge URL is configured AND responded to /health on startup. */
  get enabled(): boolean {
    return this.reachable;
  }

  async onModuleInit(): Promise<void> {
    if (!this.bridgeUrl) {
      this.logger.warn(
        'ACTIAN_BRIDGE_URL not set — vector DB disabled (ShockEngine will use seed fallback)',
      );
      return;
    }
    try {
      await axios.get(`${this.bridgeUrl}/health`, { timeout: 3000 });
      this.reachable = true;
      this.logger.log(`Vector DB bridge reachable at ${this.bridgeUrl}`);
    } catch {
      this.logger.warn(
        `Vector DB bridge unreachable at ${this.bridgeUrl} — start with: docker compose up`,
      );
    }
  }

  async upsertEventVector(
    eventId: string,
    _text: string,
    embedding: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.bridgeUrl || !this.reachable) return;
    try {
      await axios.post(
        `${this.bridgeUrl}/upsert`,
        { event_id: eventId, embedding, metadata },
        { timeout: 10_000 },
      );
    } catch (err) {
      this.logger.warn(`VectorDB upsert failed: ${(err as Error).message}`);
    }
  }

  async querySimilarEvents(
    queryEmbedding: number[],
    topK = 10,
  ): Promise<VectorSearchResult[]> {
    if (!this.bridgeUrl || !this.reachable) return [];
    try {
      const res = await axios.post<
        { event_id: string; similarity: number; metadata: Record<string, unknown> }[]
      >(
        `${this.bridgeUrl}/search`,
        { embedding: queryEmbedding, top_k: topK },
        { timeout: 10_000 },
      );
      return res.data.map((r) => ({
        eventId: r.event_id,
        similarity: r.similarity,
        metadata: r.metadata,
      }));
    } catch (err) {
      this.logger.warn(`VectorDB search failed: ${(err as Error).message}`);
      return [];
    }
  }
}
