import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SEED_STOCKS } from '../common/data/seed-data.js';
import type { Stock } from '../common/types/index.js';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ShockGlobeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ShockGlobeGateway.name);
  private mockInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: ConfigService) {}

  afterInit(): void {
    this.logger.log('ShockGlobe WebSocket Gateway initialized');
  }

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  onModuleInit(): void {
    // Only run mock ticks when no real market data provider is configured
    if (this.config.get<string>('FINNHUB_API_KEY') || this.config.get<string>('POLYGON_API_KEY')) {
      this.logger.log('Market data API key detected — mock price ticks disabled');
      return;
    }
    // Emit simulated price updates every 5 seconds
    this.mockInterval = setInterval(() => {
      if (!this.server) return;

      const stocks: Stock[] = SEED_STOCKS;
      if (stocks.length === 0) return;

      const randomStock = stocks[Math.floor(Math.random() * stocks.length)];
      const changePercent = (Math.random() - 0.5) * 4; // -2% to +2%
      const newPrice =
        Math.round(randomStock.price * (1 + changePercent / 100) * 100) / 100;

      const priceUpdate = {
        ticker: randomStock.ticker,
        companyName: randomStock.companyName,
        sector: randomStock.sector,
        price: newPrice,
        previousPrice: randomStock.price,
        change: Math.round((newPrice - randomStock.price) * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        timestamp: new Date().toISOString(),
      };

      this.emitPriceUpdate(priceUpdate);
    }, 5000);
  }

  @SubscribeMessage('subscribe:events')
  handleSubscribeEvents(client: Socket): { event: string; data: string } {
    this.logger.log(`Client ${client.id} subscribed to events`);
    client.join('events');
    return { event: 'subscribe:events', data: 'Subscribed to event feed' };
  }

  @SubscribeMessage('subscribe:shocks')
  handleSubscribeShocks(client: Socket): { event: string; data: string } {
    this.logger.log(`Client ${client.id} subscribed to shocks`);
    client.join('shocks');
    return { event: 'subscribe:shocks', data: 'Subscribed to shock updates' };
  }

  @SubscribeMessage('subscribe:prices')
  handleSubscribePrices(client: Socket): { event: string; data: string } {
    this.logger.log(`Client ${client.id} subscribed to prices`);
    client.join('prices');
    return { event: 'subscribe:prices', data: 'Subscribed to price feed' };
  }

  @SubscribeMessage('subscribe:surprises')
  handleSubscribeSurprises(client: Socket): { event: string; data: string } {
    this.logger.log(`Client ${client.id} subscribed to surprises`);
    client.join('surprises');
    return {
      event: 'subscribe:surprises',
      data: 'Subscribed to surprise alerts',
    };
  }

  emitNewEvent(event: unknown): void {
    this.server.to('events').emit('events:new', event);
  }

  emitShockUpdate(shock: unknown): void {
    this.server.to('shocks').emit('shocks:update', shock);
  }

  emitPriceUpdate(price: unknown): void {
    this.server.to('prices').emit('prices:update', price);
  }

  emitSurpriseAlert(alert: unknown): void {
    this.server.to('surprises').emit('surprises:alert', alert);
  }
}
