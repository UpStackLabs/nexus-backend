import { Module } from '@nestjs/common';
import { NlpModule } from '../nlp/nlp.module.js';
import { VectorDbModule } from '../vector-db/vector-db.module.js';
import { GatewayModule } from '../gateway/gateway.module.js';
import { EventsModule } from '../events/events.module.js';
import { GlobeModule } from '../globe/globe.module.js';
import { IngestionService } from './ingestion.service.js';
import { NewsIngestionService } from './news-ingestion.service.js';
import { IngestionController } from './ingestion.controller.js';

@Module({
  imports: [NlpModule, VectorDbModule, GatewayModule, EventsModule, GlobeModule],
  providers: [IngestionService, NewsIngestionService],
  controllers: [IngestionController],
})
export class IngestionModule {}
