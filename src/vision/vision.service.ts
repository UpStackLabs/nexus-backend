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
        label: 'building',
        confidence: 0.92,
        bbox: { x1: 50, y1: 30, x2: 400, y2: 350 },
      },
      {
        label: 'crowd',
        confidence: 0.85,
        bbox: { x1: 100, y1: 200, x2: 500, y2: 450 },
      },
    ];
  }

  private getMockClassifications(): SceneClassification[] {
    return [
      { label: 'urban_scene', score: 0.88 },
      { label: 'protest', score: 0.72 },
      { label: 'outdoor', score: 0.65 },
    ];
  }
}
