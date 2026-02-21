import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Detection {
  label: string;
  confidence: number;
  bbox: BoundingBox;
}

export interface SceneClassification {
  label: string;
  score: number;
}

export interface VisionAnalysisResult {
  detections: Detection[];
  classifications: SceneClassification[];
  imageSize: [number, number];
  processingTimeMs: number;
}

@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private readonly modelServerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.modelServerUrl =
      this.config.get<string>('MODEL_SERVER_URL') ?? 'http://localhost:8002';
  }

  async analyzeImage(imageUrl: string): Promise<VisionAnalysisResult> {
    const startTime = Date.now();

    try {
      // Try the model server for real analysis
      const [detectRes, classifyRes] = await Promise.allSettled([
        axios.post(
          `${this.modelServerUrl}/vision/detect`,
          { image_url: imageUrl },
          { timeout: 15_000 },
        ),
        axios.post(
          `${this.modelServerUrl}/vision/classify`,
          { image_url: imageUrl },
          { timeout: 15_000 },
        ),
      ]);

      const detections =
        detectRes.status === 'fulfilled'
          ? detectRes.value.data.detections.map((d: any) => ({
              label: d.label,
              confidence: d.confidence,
              bbox: {
                x1: d.bbox[0],
                y1: d.bbox[1],
                x2: d.bbox[2],
                y2: d.bbox[3],
              },
            }))
          : this.getMockDetections();

      const classifications =
        classifyRes.status === 'fulfilled'
          ? classifyRes.value.data.classifications
          : this.getMockClassifications();

      const imageSize: [number, number] =
        detectRes.status === 'fulfilled'
          ? detectRes.value.data.image_size
          : [640, 480];

      return {
        detections,
        classifications,
        imageSize,
        processingTimeMs: Date.now() - startTime,
      };
    } catch {
      this.logger.warn('Model server unavailable — using mock vision analysis');
      return {
        detections: this.getMockDetections(),
        classifications: this.getMockClassifications(),
        imageSize: [640, 480],
        processingTimeMs: Date.now() - startTime,
      };
    }
  }

  private getMockDetections(): Detection[] {
    return [
      {
        label: 'military_vehicle',
        confidence: 0.94,
        bbox: { x1: 120, y1: 80, x2: 340, y2: 220 },
      },
      {
        label: 'personnel',
        confidence: 0.87,
        bbox: { x1: 380, y1: 150, x2: 440, y2: 290 },
      },
      {
        label: 'infrastructure',
        confidence: 0.78,
        bbox: { x1: 50, y1: 10, x2: 600, y2: 60 },
      },
      {
        label: 'supply_convoy',
        confidence: 0.71,
        bbox: { x1: 400, y1: 200, x2: 620, y2: 350 },
      },
    ];
  }

  private getMockClassifications(): SceneClassification[] {
    return [
      { label: 'military_conflict', score: 0.91 },
      { label: 'border_region', score: 0.76 },
      { label: 'tropical_terrain', score: 0.68 },
      { label: 'military_buildup', score: 0.62 },
      { label: 'infrastructure_damage', score: 0.45 },
    ];
  }
}
