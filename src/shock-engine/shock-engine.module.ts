import { Module } from '@nestjs/common';
import { VectorDbModule } from '../vector-db/vector-db.module.js';
import { NlpModule } from '../nlp/nlp.module.js';
import { EventsModule } from '../events/events.module.js';
import { ShockEngineService } from './shock-engine.service.js';

@Module({
  imports: [VectorDbModule, NlpModule, EventsModule],
  providers: [ShockEngineService],
  exports: [ShockEngineService],
})
export class ShockEngineModule {}
