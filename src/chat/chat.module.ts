import { Module } from '@nestjs/common';
import { NlpModule } from '../nlp/nlp.module.js';
import { VectorDbModule } from '../vector-db/vector-db.module.js';
import { ChatService } from './chat.service.js';
import { ChatController } from './chat.controller.js';

@Module({
  imports: [NlpModule, VectorDbModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatModule {}
