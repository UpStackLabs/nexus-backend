import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from './events/events.module.js';
import { StocksModule } from './stocks/stocks.module.js';
import { GlobeModule } from './globe/globe.module.js';
import { SimulateModule } from './simulate/simulate.module.js';
import { SectorsModule } from './sectors/sectors.module.js';
import { HistoricalModule } from './historical/historical.module.js';
import { GatewayModule } from './gateway/gateway.module.js';
import { NlpModule } from './nlp/nlp.module.js';
import { VectorDbModule } from './vector-db/vector-db.module.js';
import { IngestionModule } from './ingestion/ingestion.module.js';
import { MarketDataModule } from './market-data/market-data.module.js';
import { ShockEngineModule } from './shock-engine/shock-engine.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    NlpModule,
    VectorDbModule,
    GatewayModule,
    IngestionModule,
    MarketDataModule,
    ShockEngineModule,
    EventsModule,
    StocksModule,
    GlobeModule,
    SimulateModule,
    SectorsModule,
    HistoricalModule,
  ],
})
export class AppModule {}
