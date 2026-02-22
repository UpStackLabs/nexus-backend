import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface RawNewsItem {
  title: string;
  description: string;
  rawText: string;
  source: string;
  publishedAt: string;
}

export interface NewsDisplayItem {
  title: string;
  source: string;
  publishedAt: string;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMPTY_RETRY_MS = 10 * 60 * 1000; // retry after 10 minutes when cache is empty (avoids hammering rate-limited APIs)

@Injectable()
export class NewsIngestionService {
  private readonly logger = new Logger(NewsIngestionService.name);

  private cache: { items: RawNewsItem[]; fetchedAt: number } | null = null;
  private pendingFetch: Promise<RawNewsItem[]> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Returns cached articles for display, refreshing if stale. */
  async getCachedNews(): Promise<NewsDisplayItem[]> {
    const items = await this.getOrRefreshCache();
    return items.map((i) => ({
      title: i.title,
      source: i.source,
      publishedAt: i.publishedAt,
    }));
  }

  /** Returns raw items for ingestion, using the same cache. */
  async getCachedRaw(): Promise<RawNewsItem[]> {
    return this.getOrRefreshCache();
  }

  private async getOrRefreshCache(): Promise<RawNewsItem[]> {
    if (this.cache) {
      const ttl = this.cache.items.length > 0 ? CACHE_TTL_MS : EMPTY_RETRY_MS;
      if (Date.now() - this.cache.fetchedAt < ttl) {
        return this.cache.items;
      }
    }
    // Deduplicate concurrent callers — share one in-flight fetch instead of firing N parallel requests
    if (this.pendingFetch) {
      return this.pendingFetch;
    }
    this.pendingFetch = this.fetchAll(new Date(0))
      .then((items) => {
        if (items.length > 0 || !this.cache) {
          this.cache = { items, fetchedAt: Date.now() };
        } else {
          this.logger.warn('All news sources returned 0 items — serving stale cache');
        }
        return this.cache!.items;
      })
      .finally(() => {
        this.pendingFetch = null;
      });
    return this.pendingFetch;
  }

  /** Parses GDELT's compact date format "20260220T063400Z" to an ISO string. */
  private parseGdeltDate(seendate: string): string {
    const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) return new Date().toISOString();
    return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString();
  }

  async fetchGdelt(_since: Date): Promise<RawNewsItem[]> {
    try {
      const response = await axios.get<{
        articles?: { url: string; title: string; seendate?: string; domain?: string }[];
      }>('https://api.gdeltproject.org/api/v2/doc/doc', {
        params: {
          mode: 'artlist',
          maxrecords: 25,
          format: 'json',
          query: 'geopolitical military sanctions crisis',
          timespan: '1d',
          sort: 'DateDesc',
        },
        timeout: 30000,
      });
      const articles = response.data?.articles ?? [];
      return articles.map((a) => ({
        title: a.title ?? '',
        description: '',
        rawText: a.title ?? '',
        source: a.domain ?? 'gdelt',
        publishedAt: a.seendate ? this.parseGdeltDate(a.seendate) : new Date().toISOString(),
      }));
    } catch (err) {
      this.logger.warn(`GDELT fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  async fetchNewsApi(_since: Date): Promise<RawNewsItem[]> {
    const apiKey = this.config.get<string>('NEWSAPI_KEY');
    if (!apiKey) return [];
    try {
      const response = await axios.get<{
        articles?: {
          title: string;
          description: string;
          publishedAt: string;
        }[];
      }>('https://newsapi.org/v2/everything', {
        headers: {
          'X-Api-Key': apiKey,
          'User-Agent': 'Mozilla/5.0 (compatible; Nexus/1.0)',
        },
        params: {
          q: 'geopolitical OR sanctions OR military OR "economic crisis"',
          sortBy: 'publishedAt',
          pageSize: 25,
        },
        timeout: 10000,
      });
      return (response.data?.articles ?? []).map((a) => ({
        title: a.title ?? '',
        description: a.description ?? '',
        rawText: `${a.title ?? ''} ${a.description ?? ''}`.trim(),
        source: 'newsapi',
        publishedAt: a.publishedAt ?? new Date().toISOString(),
      }));
    } catch (err) {
      this.logger.warn(`NewsAPI fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  async fetchAcled(_since: Date): Promise<RawNewsItem[]> {
    const key = this.config.get<string>('ACLED_KEY');
    const email = this.config.get<string>('ACLED_EMAIL');
    if (!key || !email) return [];
    try {
      const response = await axios.get<{
        data?: {
          event_date: string;
          event_type: string;
          notes: string;
          country: string;
        }[];
      }>('https://developer.acleddata.com/acled/read/', {
        params: {
          key,
          email,
          event_date: _since.toISOString().split('T')[0],
          event_date_where: '>',
          limit: 25,
        },
        timeout: 10000,
      });
      return (response.data?.data ?? []).map((d) => ({
        title: `${d.event_type} in ${d.country}`,
        description: d.notes ?? '',
        rawText: `${d.event_type} in ${d.country}: ${d.notes ?? ''}`.trim(),
        source: 'acled',
        publishedAt: new Date(d.event_date).toISOString(),
      }));
    } catch (err) {
      this.logger.warn(`ACLED fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  async fetchAll(since: Date): Promise<RawNewsItem[]> {
    const [gdelt, newsapi] = await Promise.all([
      this.fetchGdelt(since),
      this.fetchNewsApi(since),
    ]);
    const combined = [...gdelt, ...newsapi];
    const seen = new Set<string>();
    return combined.filter((item) => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
