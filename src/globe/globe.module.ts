import { Module } from '@nestjs/common';
import { GlobeController } from './globe.controller.js';
import { GlobeService } from './globe.service.js';

@Module({
  controllers: [GlobeController],
  providers: [GlobeService],
  exports: [GlobeService],
})
export class GlobeModule {}
