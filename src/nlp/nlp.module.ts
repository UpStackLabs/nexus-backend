import { Module } from '@nestjs/common';
import { SphinxNlpService } from './sphinx-nlp.service.js';

@Module({
  providers: [SphinxNlpService],
  exports: [SphinxNlpService],
})
export class NlpModule {}
