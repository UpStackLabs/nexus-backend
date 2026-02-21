import { Controller, Post, Body, Res, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ChatService } from './chat.service.js';
import { ChatMessageDto } from './dto/chat.dto.js';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({
    summary: 'Send a message to the Nexus AI analyst',
    description:
      'RAG-powered chat: embeds query → vector search → assembles context → Mistral-7B response. Falls back to intelligent mock responses when Ollama is unavailable.',
  })
  @ApiResponse({ status: 200, description: 'AI response' })
  async chat(
    @Body() dto: ChatMessageDto,
  ): Promise<{ response: string; model: string }> {
    const response = await this.chatService.chat(
      dto.message,
      dto.history ?? [],
    );
    return { response, model: 'mistral-7b' };
  }

  @Post('stream')
  @ApiOperation({
    summary: 'Stream a response from the Nexus AI analyst (SSE)',
    description:
      'Same as POST /chat but streams the response token-by-token via Server-Sent Events.',
  })
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  async chatStream(
    @Body() dto: ChatMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      for await (const chunk of this.chatService.chatStream(
        dto.message,
        dto.history ?? [],
      )) {
        res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      res.write(
        `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
