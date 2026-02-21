import { Module } from '@nestjs/common';
import { ShockGlobeGateway } from './shockglobe.gateway.js';

@Module({
  providers: [ShockGlobeGateway],
  exports: [ShockGlobeGateway],
})
export class GatewayModule {}
