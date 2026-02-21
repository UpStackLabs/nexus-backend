import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ description: 'User message to the AI analyst', example: 'What stocks are most exposed to the Venezuelan crisis?' })
  @IsString()
  @MinLength(1)
  message: string;

  @ApiPropertyOptional({ description: 'Conversation history for context', type: [Object] })
  @IsOptional()
  @IsArray()
  history?: { role: 'user' | 'assistant'; content: string }[];
}
