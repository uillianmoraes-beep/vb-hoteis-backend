import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // fotos das categorias vão em base64 (já reduzidas no navegador): corpo de até 1 MB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exp = app as any;
  exp.useBodyParser('json', { limit: '1mb' });
  exp.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  app.setGlobalPrefix('api');

  const origens = (process.env.CORS_ORIGENS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origens.length ? origens : true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const porta = Number(process.env.PORT || 8080);
  await app.listen(porta, '0.0.0.0');
  Logger.log(`API VB Soluções Hoteleiras rodando na porta ${porta}`, 'Bootstrap');
}

bootstrap();
