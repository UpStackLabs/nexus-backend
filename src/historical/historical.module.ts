import { Module } from '@nestjs/common';
import { HistoricalController } from './historical.controller.js';
import { HistoricalService } from './historical.service.js';

@Module({
  controllers: [HistoricalController],
  providers: [HistoricalService],
  exports: [HistoricalService],
})
export class HistoricalModule {}
