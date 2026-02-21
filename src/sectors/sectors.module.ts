import { Module } from '@nestjs/common';
import { SectorsController } from './sectors.controller.js';
import { SectorsService } from './sectors.service.js';

@Module({
  controllers: [SectorsController],
  providers: [SectorsService],
  exports: [SectorsService],
})
export class SectorsModule {}
