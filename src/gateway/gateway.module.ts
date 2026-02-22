import { Module } from '@nestjs/common';
import { NexusGateway } from './nexus.gateway.js';

@Module({
  providers: [NexusGateway],
  exports: [NexusGateway],
})
export class GatewayModule {}
