import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Pool } from 'pg';

export interface VectorSearchResult {
  eventId: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class VectorDbService implements OnModuleInit {
  private readonly logger = new Logger(VectorDbService.name);
  private pool: Pool | null = null;
  private readonly connectionType: string;
  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.connectionType = this.config.get<string>('ACTIAN_CONNECTION_TYPE') ?? 'rest';
    this.baseUrl = this.config.get<string>('ACTIAN_BASE_URL');
    this.apiKey = this.config.get<string>('ACTIAN_API_KEY');
  }

  async onModuleInit(): Promise<void> {
    if (this.connectionType === 'pg') {
      const host = this.config.get<string>('ACTIAN_PG_HOST');
      if (!host) {
        this.logger.warn('ACTIAN_PG_HOST not set — vector DB (PG) disabled');
        return;
      }
      this.pool = new Pool({
        host,
        port: this.config.get<number>('ACTIAN_PG_PORT') ?? 5432,
        database: this.config.get<string>('ACTIAN_PG_DATABASE') ?? 'shockglobe',
        user: this.config.get<string>('ACTIAN_PG_USER') ?? 'admin',
        password: this.config.get<string>('ACTIAN_PG_PASSWORD'),
      });
      try {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS event_vectors (
            id SERIAL PRIMARY KEY,
            event_id TEXT UNIQUE NOT NULL,
            embedding VECTOR(1536),
            metadata JSONB
          )
        `);
        this.logger.log('Vector DB (PG) initialized');
      } catch (err) {
        this.logger.warn(`Vector DB (PG) init failed: ${(err as Error).message}`);
        this.pool = null;
      }
    } else if (!this.baseUrl) {
      this.logger.warn('ACTIAN_BASE_URL not set — vector DB (REST) disabled');
    }
  }

  async upsertEventVector(
    eventId: string,
    _text: string,
    embedding: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (this.connectionType === 'pg' && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO event_vectors (event_id, embedding, metadata)
           VALUES ($1, $2::vector, $3)
           ON CONFLICT (event_id) DO UPDATE SET embedding = $2::vector, metadata = $3`,
          [eventId, JSON.stringify(embedding), metadata],
        );
      } catch (err) {
        this.logger.warn(`PG upsert failed: ${(err as Error).message}`);
      }
      return;
    }
    if (this.connectionType === 'rest' && this.baseUrl) {
      try {
        await axios.post(
          `${this.baseUrl}/vectors`,
          { eventId, embedding, metadata },
          { headers: { Authorization: this.apiKey } },
        );
      } catch (err) {
        this.logger.warn(`REST upsert failed: ${(err as Error).message}`);
      }
    }
  }

  async querySimilarEvents(
    queryEmbedding: number[],
    topK = 10,
  ): Promise<VectorSearchResult[]> {
    if (this.connectionType === 'pg' && this.pool) {
      try {
        const result = await this.pool.query<{
          event_id: string;
          similarity: number;
          metadata: Record<string, unknown>;
        }>(
          `SELECT event_id, 1 - (embedding <=> $1::vector) AS similarity, metadata
           FROM event_vectors
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [JSON.stringify(queryEmbedding), topK],
        );
        return result.rows.map((r) => ({
          eventId: r.event_id,
          similarity: r.similarity,
          metadata: r.metadata,
        }));
      } catch (err) {
        this.logger.warn(`PG query failed: ${(err as Error).message}`);
        return [];
      }
    }
    if (this.connectionType === 'rest' && this.baseUrl) {
      try {
        const response = await axios.post<VectorSearchResult[]>(
          `${this.baseUrl}/vectors/search`,
          { embedding: queryEmbedding, topK },
          { headers: { Authorization: this.apiKey } },
        );
        return response.data;
      } catch (err) {
        this.logger.warn(`REST query failed: ${(err as Error).message}`);
        return [];
      }
    }
    return [];
  }
}
