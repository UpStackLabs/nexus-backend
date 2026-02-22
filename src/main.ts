import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix for all REST routes
  app.setGlobalPrefix('api');

  // CORS — support comma-separated origins or wildcard
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  const origins = corsOrigin.includes(',')
    ? corsOrigin.split(',').map((o) => o.trim())
    : corsOrigin;
  app.enableCors({
    origin: origins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger / OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('Nexus API')
    .setDescription(
      'Backend API for Nexus — Global Event-Driven Market Shock Visualizer. ' +
        'Connects global events (geopolitical crises, economic shifts, military movements, ' +
        'policy changes) to predicted market impacts across countries, sectors, and stocks.',
    )
    .setVersion('1.0')
    .addTag('Events', 'Global event tracking and management')
    .addTag('Stocks', 'Stock data with shock history and surprise analysis')
    .addTag('Globe', 'Globe visualization data (heatmaps, arcs, markers)')
    .addTag('Simulation', 'What-if event simulation engine')
    .addTag('Sectors', 'Sector-level aggregate shock data')
    .addTag('Historical', 'Historical event matching and similarity search')
    .addTag('Chat', 'RAG-powered AI financial analyst (Mistral-7B + VectorAI)')
    .addTag('OSINT', 'Satellite/CCTV image analysis pipeline (YOLOv8 + CLIP)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // Graceful shutdown for ECS SIGTERM
  app.enableShutdownHooks();

  console.log(`Nexus API running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
