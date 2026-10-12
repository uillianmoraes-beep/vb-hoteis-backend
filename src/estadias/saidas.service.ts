import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Estadia } from './estadia.entity';
import { EstadiaEvento } from './estadia-evento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UsuarioToken } from '../common/permissoes';
import { RegistrarSaidaDto } from './estadias.dto';

const DIA = 86_400_000;
const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Portão de saída: confere o ticket (nº do uso) e registra quem liberou e quando. */
@Injectable()
export class SaidasService {
  constructor(
    @InjectRepository(Estadia) private readonly repo: Repository<Estadia>,
    @InjectRepository(EstadiaEvento) private readonly eventos: Repository<EstadiaEvento>,
    @InjectRepository(Unidade) private readonly unidades: Repository<Unidade>,
  ) {}

  async registrar(u: UsuarioToken, dto: RegistrarSaidaDto) {
    const e = await this.repo.findOne({ where: { empresaId: u.empresaId, numero: dto.numero } });
    if (!e) throw new NotFoundException(`Ticket nº ${dto.numero} não encontrado.`);
    if (u.ambientesIds?.length && !u.ambientesIds.includes(e.ambienteId)) throw new NotFoundException(`Ticket nº ${dto.numero} não encontrado.`);
    const unidade = await this.unidades.findOne({ where: { id: e.unidadeId } });
    if (dto.unidade && unidade && dto.unidade.replace(/^0+/, '') !== unidade.codigo.replace(/^0+/, '')) {
      throw new BadRequestException(`Este ticket é da suíte ${unidade.codigo}, não da ${dto.unidade}. Confira o ticket.`);
    }
    if (e.status === 'cancelada') throw new BadRequestException('Esta entrada foi cancelada. Chame a recepção.');
    if (e.saidaPortariaEm) throw new BadRequestException(`Ticket já usado: saída registrada às ${hora(e.saidaPortariaEm)} por ${e.saidaPortariaPor ?? '—'}.`);
    if (e.status === 'aberta') throw new BadRequestException('A conta desta suíte ainda não foi entregue. Chame a recepção antes de liberar.');
    const situacao = e.status === 'fechada' ? 'paga' : 'pendente';
    const agora = new Date();
    await this.repo.update({ id: e.id }, { saidaPortariaEm: agora, saidaPortariaPor: u.nome, saidaPortariaSituacao: situacao });
    await this.eventos.insert({
      empresaId: u.empresaId, estadiaId: e.id, tipo: 'saida', usuarioId: u.sub, usuarioNome: u.nome,
      descricao: `Saída no portão (ticket nº ${e.numero})${situacao === 'pendente' ? ' · conta ainda não fechada no sistema' : ''}`,
    });
    return { numero: e.numero, unidade: unidade?.codigo ?? '', placa: e.placa, situacao, hora: agora };
  }

  async listar(u: UsuarioToken, filtro: { de?: string; ate?: string }) {
    const ate = filtro.ate ? new Date(`${filtro.ate}T23:59:59.999-03:00`) : new Date();
    const de = filtro.de ? new Date(`${filtro.de}T00:00:00-03:00`) : new Date(ate.getTime() - DIA);
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) throw new BadRequestException('Período inválido.');
    const qb = this.repo.createQueryBuilder('e')
      .where('e.empresaId = :emp', { emp: u.empresaId })
      .andWhere('e.saidaPortariaEm BETWEEN :de AND :ate', { de, ate });
    if (u.ambientesIds?.length) qb.andWhere('e.ambienteId IN (:...amb)', { amb: u.ambientesIds });
    const lista: Estadia[] = await qb.orderBy('e.saidaPortariaEm', 'DESC').limit(2000).getMany();
    const unidades = lista.length ? await this.unidades.find({ where: { id: In([...new Set(lista.map((e) => e.unidadeId))]) } }) : [];
    const cod = new Map(unidades.map((x) => [x.id, x.codigo]));
    return lista.map((e) => ({
      id: e.id, numero: e.numero, unidade: cod.get(e.unidadeId) ?? '—', placa: e.placa,
      saidaEm: e.saidaPortariaEm, por: e.saidaPortariaPor, situacao: e.saidaPortariaSituacao,
      statusConta: e.status,
    }));
  }
}
