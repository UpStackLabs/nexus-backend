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

@Injectable()
export class NewsIngestionService {
  private readonly logger = new Logger(NewsIngestionService.name);

  constructor(private readonly config: ConfigService) {}

  async fetchGdelt(since: Date): Promise<RawNewsItem[]> {
    try {
      const response = await axios.get<{
        articles?: { url: string; title: string }[];
      }>('https://api.gdeltproject.org/api/v2/doc/doc', {
        params: {
          mode: 'artlist',
          maxrecords: 25,
          format: 'json',
          query: 'geopolitical economic military',
          startdatetime: since
            .toISOString()
            .replace(/[-:]/g, '')
            .split('.')[0],
        },
        timeout: 10000,
      });
      const articles = response.data?.articles ?? [];
      return articles.map((a) => ({
        title: a.title ?? '',
        description: '',
        rawText: a.title ?? '',
        source: 'gdelt',
        publishedAt: new Date().toISOString(),
      }));
    } catch (err) {
      this.logger.warn(`GDELT fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  async fetchNewsApi(since: Date): Promise<RawNewsItem[]> {
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
        headers: { 'X-Api-Key': apiKey },
        params: {
          q: 'geopolitical OR sanctions OR military OR "economic crisis"',
          from: since.toISOString(),
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

  async fetchAcled(since: Date): Promise<RawNewsItem[]> {
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
      }>('https://api.acleddata.com/acled/read', {
        params: {
          key,
          email,
          event_date: since.toISOString().split('T')[0],
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
    const [gdelt, newsapi, acled] = await Promise.all([
      this.fetchGdelt(since),
      this.fetchNewsApi(since),
      this.fetchAcled(since),
    ]);
    const combined = [...gdelt, ...newsapi, ...acled];
    const seen = new Set<string>();
    return combined.filter((item) => {
      const key = item.title.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
