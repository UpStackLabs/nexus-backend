import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsModule } from './events/events.module.js';
import { StocksModule } from './stocks/stocks.module.js';
import { GlobeModule } from './globe/globe.module.js';
import { SimulateModule } from './simulate/simulate.module.js';
import { SectorsModule } from './sectors/sectors.module.js';
import { HistoricalModule } from './historical/historical.module.js';
import { GatewayModule } from './gateway/gateway.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventsModule,
    StocksModule,
    GlobeModule,
    SimulateModule,
    SectorsModule,
    HistoricalModule,
    GatewayModule,
  ],
})
export class AppModule {}
