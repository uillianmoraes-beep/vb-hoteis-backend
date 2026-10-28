import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { RegistraErrosFilter } from './revenda/erros.filter';
import { RevendaService } from './revenda/revenda.service';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { protecao } from './common/protecao';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // fotos das categorias vão em base64 (já reduzidas no navegador): corpo de até 1 MB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exp = app as any;
  exp.useBodyParser('json', { limit: '15mb' });
  exp.useBodyParser('urlencoded', { limit: '3mb', extended: true });
  // restaurar backup: o arquivo vai inteiro no corpo (application/octet-stream)
  exp.useBodyParser('raw', { type: 'application/octet-stream', limit: '300mb' });

  // cabeçalhos de segurança e limite de tentativas por endereço
  exp.disable?.('x-powered-by');
  exp.use(protecao);
  app.setGlobalPrefix('api');
  // erro inesperado (500) fica guardado para a Virtual Barra ver no painel da revenda
  app.useGlobalFilters(new RegistraErrosFilter(app.get(HttpAdapterHost).httpAdapter).usar(app.get(RevendaService)));

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
