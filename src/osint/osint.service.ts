import { Injectable, Logger } from '@nestjs/common';
import { SphinxNlpService } from '../nlp/sphinx-nlp.service.js';
import { VectorDbService } from '../vector-db/vector-db.service.js';
import { ShockGlobeGateway } from '../gateway/shockglobe.gateway.js';
import { VisionService } from '../vision/vision.service.js';
import type { VisionAnalysisResult } from '../vision/vision.service.js';
import { v4 as uuidv4 } from 'uuid';

export interface OsintAnalysisResult {
  id: string;
  imageUrl: string;
  context: string | null;
  coordinates: { lat: number; lng: number } | null;
  vision: VisionAnalysisResult;
  classification: {
    type: string;
    severity: number;
    location: string;
    affectedCountries: string[];
    affectedSectors: string[];
    affectedTickers: string[];
  };
  eventId: string | null;
  timestamp: string;
}

@Injectable()
export class OsintService {
  private readonly logger = new Logger(OsintService.name);

  constructor(
    private readonly vision: VisionService,
    private readonly nlp: SphinxNlpService,
    private readonly vectorDb: VectorDbService,
    private readonly gateway: ShockGlobeGateway,
  ) {}

  async analyzeImage(
    imageUrl: string,
    context?: string,
    coordinates?: string,
  ): Promise<OsintAnalysisResult> {
    const id = uuidv4();
    const startTime = Date.now();

    // 1. Run vision analysis (object detection + scene classification)
    this.logger.log(`OSINT analysis started: ${id}`);
    const visionResult = await this.vision.analyzeImage(imageUrl);

    // 2. Build text description from vision results for NLP classification
    const detectionSummary = visionResult.detections
      .map((d) => `${d.label} (${(d.confidence * 100).toFixed(0)}%)`)
      .join(', ');
    const sceneSummary = visionResult.classifications
      .slice(0, 3)
      .map((c) => c.label)
      .join(', ');
    const textForNlp =
      `Image analysis: Detected objects: ${detectionSummary}. Scene: ${sceneSummary}.` +
      (context ? ` Context: ${context}` : '') +
      (coordinates ? ` Location: ${coordinates}` : '');

    // 3. Classify the event from the vision summary
    const classification = await this.nlp.classifyEvent(textForNlp);

    // 4. Embed and store in vector DB
    let eventId: string | null = null;
    try {
      const embedding = await this.nlp.embed(textForNlp);
      eventId = `OSINT-${id.slice(0, 8)}`;
      await this.vectorDb.upsertEventVector(eventId, textForNlp, embedding, {
        source: 'osint-vision',
        imageUrl,
        detections: detectionSummary,
        scene: sceneSummary,
        ...classification,
      });
    } catch {
      this.logger.warn('Failed to store OSINT event in vector DB');
    }

    // 5. Parse coordinates
    let parsedCoords: { lat: number; lng: number } | null = null;
    if (coordinates) {
      const parts = coordinates.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        parsedCoords = { lat: parts[0], lng: parts[1] };
      }
    }

    const result: OsintAnalysisResult = {
      id,
      imageUrl,
      context: context ?? null,
      coordinates: parsedCoords,
      vision: visionResult,
      classification,
      eventId,
      timestamp: new Date().toISOString(),
    };

    // 6. Broadcast to connected clients
    this.gateway.emitNewEvent({
      id: eventId ?? id,
      title: `OSINT: ${sceneSummary}`,
      type: classification.type,
      severity: classification.severity,
      source: 'osint-vision',
      timestamp: result.timestamp,
      location: parsedCoords ?? { lat: 10.48, lng: -66.88 },
      detections: visionResult.detections.length,
      classifications: visionResult.classifications.slice(0, 3),
    });

    this.logger.log(
      `OSINT analysis complete: ${id} (${Date.now() - startTime}ms) — ${visionResult.detections.length} detections, type=${classification.type}`,
    );

    return result;
  }
}
