import { Module } from '@nestjs/common';
import { NlpModule } from '../nlp/nlp.module.js';
import { VectorDbModule } from '../vector-db/vector-db.module.js';
import { GatewayModule } from '../gateway/gateway.module.js';
import { VisionModule } from '../vision/vision.module.js';
import { OsintService } from './osint.service.js';
import { OsintController } from './osint.controller.js';

@Module({
  imports: [NlpModule, VectorDbModule, GatewayModule, VisionModule],
  providers: [OsintService],
  controllers: [OsintController],
})
export class OsintModule {}
