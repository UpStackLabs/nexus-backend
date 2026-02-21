import { Module } from '@nestjs/common';
import { GlobeController } from './globe.controller.js';
import { GlobeService } from './globe.service.js';
import { EventsModule } from '../events/events.module.js';

@Module({
  imports: [EventsModule],
  controllers: [GlobeController],
  providers: [GlobeService],
  exports: [GlobeService],
})
export class GlobeModule {}
