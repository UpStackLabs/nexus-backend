import { Module } from '@nestjs/common';
import { HistoricalController } from './historical.controller.js';
import { HistoricalService } from './historical.service.js';
import { EventsModule } from '../events/events.module.js';

@Module({
  imports: [EventsModule],
  controllers: [HistoricalController],
  providers: [HistoricalService],
})
export class HistoricalModule {}
