import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { RevendaService } from './revenda.service';

/** erro inesperado do servidor (500): guarda agrupado para a Virtual Barra ver no painel da revenda */
@Catch()
export class RegistraErrosFilter extends BaseExceptionFilter {
  private revenda: RevendaService | null = null;
  usar(r: RevendaService) { this.revenda = r; return this; }

  catch(exception: unknown, host: ArgumentsHost) {
    // só o que não foi previsto: erro sem tratamento (os avisos 503 de propósito não contam)
    const inesperado = !(exception instanceof HttpException) || exception.getStatus() === 500;
    if (inesperado && this.revenda) {
      const req = host.switchToHttp().getRequest();
      const e = exception instanceof Error ? exception : new Error(String(exception));
      this.revenda.registrarErro({
        origem: 'servidor', mensagem: e.message || 'Erro sem mensagem', detalhe: (e.stack ?? '').split('\n').slice(0, 8).join('\n'),
        tela: `${req?.method ?? ''} ${req?.originalUrl ?? req?.url ?? ''}`, empresaId: req?.usuario?.empresaId ?? null, usuario: req?.usuario?.nome ?? null,
      }).catch(() => undefined);
    }
    super.catch(exception, host);
  }
}
