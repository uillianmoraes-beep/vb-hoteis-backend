import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { STATUS_UNIDADE, StatusUnidade, UsuarioToken } from '../common/permissoes';

/**
 * Tempos de alerta da faixa "Precisa de você agora" (em minutos).
 * Ficam fixos neste lote; viram configuração por estabelecimento depois.
 */
const ALERTA_MINUTOS: Partial<Record<StatusUnidade, number>> = {
  limpeza: 40,
  vistoria: 15,
  conta_entregue: 10,
};

export interface AlertaPainel {
  unidadeId: string;
  codigo: string;
  tipo: 'limpeza_demorada' | 'vistoria_aguardando' | 'conta_aguardando' | 'bloqueada';
  mensagem: string;
  minutos: number;
  urgencia: number;
}

@Injectable()
export class PainelService {
  constructor(
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
  ) {}

  async montar(u: UsuarioToken, ambienteId?: string) {
    const restrito = u.ambientesIds && u.ambientesIds.length ? u.ambientesIds : null;
    if (ambienteId && restrito && !restrito.includes(ambienteId)) {
      throw new ForbiddenException('Ambiente não liberado para você.');
    }

    const whereAmb: FindOptionsWhere<Ambiente> = { empresaId: u.empresaId, ativo: true };
    if (restrito) whereAmb.id = In(restrito);
    const ambientes = await this.ambientes.find({ where: whereAmb, order: { ordem: 'ASC', nome: 'ASC' } });

    const whereUni: FindOptionsWhere<Unidade> = { empresaId: u.empresaId, ativo: true };
    if (ambienteId) whereUni.ambienteId = ambienteId;
    else if (restrito) whereUni.ambienteId = In(restrito);

    const lista = await this.unidades.find({
      where: whereUni,
      relations: { categoria: true, motivoBloqueio: true },
      order: { ordem: 'ASC', codigo: 'ASC' },
    });

    const agora = Date.now();
    const resumo = Object.fromEntries(STATUS_UNIDADE.map((s) => [s, 0])) as Record<StatusUnidade, number>;
    const alertas: AlertaPainel[] = [];

    const unidades = lista.map((x) => {
      const minutos = Math.max(0, Math.floor((agora - new Date(x.statusDesde).getTime()) / 60000));
      resumo[x.status] = (resumo[x.status] ?? 0) + 1;

      const limite = ALERTA_MINUTOS[x.status];
      if (x.status === 'limpeza' && limite !== undefined && minutos >= limite) {
        alertas.push({ unidadeId: x.id, codigo: x.codigo, tipo: 'limpeza_demorada', minutos,
          mensagem: `Limpeza há ${minutos} min`, urgencia: 2 });
      } else if (x.status === 'vistoria' && limite !== undefined && minutos >= limite) {
        alertas.push({ unidadeId: x.id, codigo: x.codigo, tipo: 'vistoria_aguardando', minutos,
          mensagem: `Aguardando vistoria há ${minutos} min`, urgencia: 2 });
      } else if (x.status === 'conta_entregue' && limite !== undefined && minutos >= limite) {
        alertas.push({ unidadeId: x.id, codigo: x.codigo, tipo: 'conta_aguardando', minutos,
          mensagem: `Conta entregue há ${minutos} min`, urgencia: 3 });
      } else if (x.status === 'bloqueada') {
        alertas.push({ unidadeId: x.id, codigo: x.codigo, tipo: 'bloqueada', minutos,
          mensagem: `Bloqueada: ${x.motivoBloqueio?.nome ?? 'sem motivo'}`, urgencia: 1 });
      }

      return {
        id: x.id,
        codigo: x.codigo,
        nome: x.nome,
        tipo: x.tipo,
        ambienteId: x.ambienteId,
        ambientePadraoId: x.ambientePadraoId,
        andar: x.andar,
        garagem: x.garagem,
        categoria: x.categoria ? { id: x.categoria.id, nome: x.categoria.nome } : null,
        status: x.status,
        statusDesde: x.statusDesde,
        minutosNoStatus: minutos,
        motivoBloqueio: x.motivoBloqueio ? { id: x.motivoBloqueio.id, nome: x.motivoBloqueio.nome, cor: x.motivoBloqueio.cor } : null,
        observacaoStatus: x.observacaoStatus,
        plantaX: x.plantaX !== null ? Number(x.plantaX) : null,
        plantaY: x.plantaY !== null ? Number(x.plantaY) : null,
      };
    });

    alertas.sort((a, b) => b.urgencia - a.urgencia || b.minutos - a.minutos);

    return { geradoEm: new Date(agora).toISOString(), ambientes, resumo, alertas, unidades };
  }
}
