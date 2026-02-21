import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module.js';
import { MarketDataService } from './market-data.service.js';

@Module({
  imports: [GatewayModule],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
