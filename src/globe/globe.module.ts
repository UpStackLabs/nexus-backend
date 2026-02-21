import { Module } from '@nestjs/common';
import { GlobeController } from './globe.controller.js';
import { GlobeService } from './globe.service.js';
import { EventsModule } from '../events/events.module.js';
import { VectorDbModule } from '../vector-db/vector-db.module.js';
import { NlpModule } from '../nlp/nlp.module.js';

@Module({
  imports: [EventsModule, VectorDbModule, NlpModule],
  controllers: [GlobeController],
  providers: [GlobeService],
  exports: [GlobeService],
})
export class GlobeModule {}
