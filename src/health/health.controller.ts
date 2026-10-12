import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Publico } from '../common/decorators/publico.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  @Publico()
  @Get()
  async verificar() {
    try {
      await this.ds.query('SELECT 1');
      return { status: 'ok', banco: 'conectado', horario: new Date().toISOString() };
    } catch (e) {
      return { status: 'erro', banco: 'desconectado', detalhe: (e as Error).message };
    }
  }
}
