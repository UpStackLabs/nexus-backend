import { Module } from '@nestjs/common';
import { StocksController } from './stocks.controller.js';
import { StocksService } from './stocks.service.js';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { ShockEngineModule } from '../shock-engine/shock-engine.module.js';

@Module({
  imports: [MarketDataModule, ShockEngineModule],
  controllers: [StocksController],
  providers: [StocksService],
  exports: [StocksService],
})
export class StocksModule {}
