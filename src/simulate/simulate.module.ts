import { Module } from '@nestjs/common';
import { SimulateController } from './simulate.controller.js';
import { SimulateService } from './simulate.service.js';

@Module({
  controllers: [SimulateController],
  providers: [SimulateService],
  exports: [SimulateService],
})
export class SimulateModule {}
