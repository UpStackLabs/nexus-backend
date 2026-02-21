import { Module } from '@nestjs/common';
import { StocksController } from './stocks.controller.js';
import { StocksService } from './stocks.service.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { ShockEngineModule } from '../shock-engine/shock-engine.module.js';
import { NlpModule } from '../nlp/nlp.module.js';

@Module({
  imports: [MarketDataModule, ShockEngineModule, NlpModule],
  controllers: [StocksController],
  providers: [StocksService],
  exports: [StocksService],
})
export class StocksModule {}
