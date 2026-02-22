import { Module } from '@nestjs/common';
import { SimulateController } from './simulate.controller.js';
import { SimulateService } from './simulate.service.js';
import { NlpModule } from '../nlp/nlp.module.js';
import { GatewayModule } from '../gateway/gateway.module.js';

@Module({
  imports: [NlpModule, GatewayModule],
  controllers: [SimulateController],
  providers: [SimulateService],
})
export class SimulateModule {}
