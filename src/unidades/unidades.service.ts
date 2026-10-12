import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, Repository } from 'typeorm';
import { Unidade } from './unidade.entity';
import { UnidadeEvento } from './unidade-evento.entity';
import { MotivoBloqueio } from '../motivos-bloqueio/motivo-bloqueio.entity';
import { Estadia } from '../estadias/estadia.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import {
  AtualizarUnidadeDto, CriarUnidadeDto, CriarUnidadesLoteDto, MudarStatusDto,
} from './dto/unidades.dto';
import { StatusUnidade, temPermissao, UsuarioToken } from '../common/permissoes';

/** De onde cada status pode vir. Livre só depois da vistoria (a revisora libera). */
const ORIGENS_PERMITIDAS: Partial<Record<StatusUnidade, StatusUnidade[]>> = {
  livre: ['vistoria', 'reservada', 'bloqueada'],
  vistoria: ['limpeza', 'bloqueada'],
};

@Injectable()
export class UnidadesService {
  constructor(
    @InjectRepository(Unidade) private readonly repo: Repository<Unidade>,
    @InjectRepository(UnidadeEvento) private readonly eventos: Repository<UnidadeEvento>,
    @InjectRepository(Ambiente) private readonly ambientes: Repository<Ambiente>,
    @InjectRepository(MotivoBloqueio) private readonly motivos: Repository<MotivoBloqueio>,
    @InjectRepository(Estadia) private readonly estadias: Repository<Estadia>,
    private readonly ds: DataSource,
  ) {}

  private podeVerAmbiente(u: UsuarioToken, ambienteId: string) {
    return !u.ambientesIds || u.ambientesIds.length === 0 || u.ambientesIds.includes(ambienteId);
  }

  async listar(u: UsuarioToken, ambienteId?: string) {
    const where: FindOptionsWhere<Unidade> = { empresaId: u.empresaId, ativo: true };
    if (ambienteId) {
      if (!this.podeVerAmbiente(u, ambienteId)) throw new ForbiddenException('Ambiente não liberado para você.');
      where.ambienteId = ambienteId;
    } else if (u.ambientesIds && u.ambientesIds.length) {
      where.ambienteId = In(u.ambientesIds);
    }
    return this.repo.find({
      where,
      relations: { categoria: true, motivoBloqueio: true },
      order: { ordem: 'ASC', codigo: 'ASC' },
    });
  }

  async buscar(u: UsuarioToken, id: string) {
    const unidade = await this.repo.findOne({
      where: { id, empresaId: u.empresaId },
      relations: { categoria: true, motivoBloqueio: true, ambiente: true },
    });
    if (!unidade) throw new NotFoundException('Unidade não encontrada.');
    if (!this.podeVerAmbiente(u, unidade.ambienteId)) throw new ForbiddenException('Unidade de outro ambiente.');
    return unidade;
  }

  private async validarAmbiente(empresaId: string, ambienteId: string) {
    const ok = await this.ambientes.exists({ where: { id: ambienteId, empresaId } });
    if (!ok) throw new BadRequestException('Ambiente inválido.');
  }

  private async validarCodigoLivre(empresaId: string, codigo: string, ignorarId?: string) {
    const existente = await this.repo.findOne({ where: { empresaId, codigo } });
    if (existente && existente.id !== ignorarId) {
      throw new BadRequestException(`Já existe uma unidade com o código ${codigo}.`);
    }
  }

  async criar(u: UsuarioToken, dto: CriarUnidadeDto) {
    await this.validarAmbiente(u.empresaId, dto.ambienteId);
    await this.validarCodigoLivre(u.empresaId, dto.codigo);
    const unidade = this.repo.create({
      ...dto,
      empresaId: u.empresaId,
      ambientePadraoId: dto.ambienteId,
      status: 'livre',
    });
    return this.repo.save(unidade);
  }

  async criarEmLote(u: UsuarioToken, dto: CriarUnidadesLoteDto) {
    if (dto.ate < dto.de) throw new BadRequestException('O número final deve ser maior que o inicial.');
    if (dto.ate - dto.de > 499) throw new BadRequestException('Máximo de 500 unidades por vez.');
    await this.validarAmbiente(u.empresaId, dto.ambienteId);

    const digitos = dto.digitos ?? 2;
    const codigos: string[] = [];
    for (let n = dto.de; n <= dto.ate; n++) {
      codigos.push(`${dto.prefixo ?? ''}${String(n).padStart(digitos, '0')}`);
    }
    const existentes = await this.repo.find({ where: { empresaId: u.empresaId, codigo: In(codigos) } });
    const jaExiste = new Set(existentes.map((e) => e.codigo));

    const novas = codigos
      .filter((c) => !jaExiste.has(c))
      .map((codigo, i) =>
        this.repo.create({
          empresaId: u.empresaId,
          ambienteId: dto.ambienteId,
          ambientePadraoId: dto.ambienteId,
          categoriaId: dto.categoriaId ?? null,
          tipo: dto.tipo ?? 'suite',
          andar: dto.andar ?? null,
          codigo,
          ordem: dto.de + i,
          status: 'livre',
        }),
      );
    const salvas = await this.repo.save(novas);
    return { criadas: salvas.length, ignoradas: [...jaExiste] };
  }

  async atualizar(u: UsuarioToken, id: string, dto: AtualizarUnidadeDto) {
    const unidade = await this.buscar(u, id);
    if (dto.ambienteId) await this.validarAmbiente(u.empresaId, dto.ambienteId);
    if (dto.ambientePadraoId) await this.validarAmbiente(u.empresaId, dto.ambientePadraoId);
    if (dto.codigo && dto.codigo !== unidade.codigo) await this.validarCodigoLivre(u.empresaId, dto.codigo, id);

    const { plantaX, plantaY, ...resto } = dto;
    Object.assign(unidade, resto);
    if (plantaX !== undefined) unidade.plantaX = plantaX === null ? null : String(plantaX);
    if (plantaY !== undefined) unidade.plantaY = plantaY === null ? null : String(plantaY);
    // relações carregadas atrapalham o save quando o id muda
    delete unidade.categoria;
    delete unidade.ambiente;
    delete unidade.motivoBloqueio;
    return this.repo.save(unidade);
  }

  async mudarStatus(u: UsuarioToken, id: string, dto: MudarStatusDto) {
    const unidade = await this.buscar(u, id);
    const atual = unidade.status;
    const novo = dto.status;

    if (atual === novo && novo !== 'bloqueada') {
      throw new BadRequestException(`A unidade já está como ${novo}.`);
    }

    // Unidade com conta aberta: muda só pela conta (entregar, fechar ou cancelar)
    if (await this.estadias.exists({ where: { unidadeId: unidade.id, status: In(['aberta', 'conta_entregue']) } })) {
      throw new BadRequestException('Esta unidade tem uma conta aberta. Use entregar, fechar ou cancelar a conta.');
    }
    // No motel, ocupar só pela entrada (para a conta correr)
    if ((novo === 'ocupada' || novo === 'conta_entregue') && unidade.ambiente?.tipo === 'motel') {
      throw new BadRequestException('No motel, use "Dar entrada" para ocupar a unidade.');
    }

    // Permissões específicas
    if (novo === 'bloqueada' && !temPermissao(u, 'unidades.bloquear')) {
      throw new ForbiddenException('Seu perfil não pode bloquear unidades.');
    }
    if (atual === 'bloqueada' && novo !== 'bloqueada' && !temPermissao(u, 'unidades.desbloquear')) {
      throw new ForbiddenException('Seu perfil não pode desbloquear unidades.');
    }
    if (novo !== 'bloqueada' && atual !== 'bloqueada' && !temPermissao(u, 'unidades.status')) {
      throw new ForbiddenException('Seu perfil não pode mudar o status das unidades.');
    }

    // Sequência obrigatória
    const origens = ORIGENS_PERMITIDAS[novo];
    if (origens && !origens.includes(atual)) {
      const msg =
        novo === 'livre'
          ? 'A unidade precisa passar pela vistoria antes de ficar livre.'
          : `Não é possível ir de ${atual} para ${novo}.`;
      throw new BadRequestException(msg);
    }

    // Bloqueio exige motivo
    let motivoId: string | null = null;
    if (novo === 'bloqueada') {
      if (!dto.motivoBloqueioId) throw new BadRequestException('Informe o motivo do bloqueio.');
      const motivo = await this.motivos.findOne({
        where: { id: dto.motivoBloqueioId, empresaId: u.empresaId, ativo: true },
      });
      if (!motivo) throw new BadRequestException('Motivo de bloqueio inválido.');
      motivoId = motivo.id;
    }

    await this.ds.transaction(async (m) => {
      await m.update(Unidade, { id: unidade.id }, {
        status: novo,
        statusDesde: new Date(),
        motivoBloqueioId: motivoId,
        observacaoStatus: dto.observacao ?? null,
      });
      await m.insert(UnidadeEvento, {
        empresaId: u.empresaId,
        unidadeId: unidade.id,
        statusAnterior: atual,
        statusNovo: novo,
        motivoBloqueioId: motivoId,
        observacao: dto.observacao ?? null,
        usuarioId: u.sub,
        usuarioNome: u.nome,
      });
    });

    return this.buscar(u, id);
  }

  async historico(u: UsuarioToken, id: string, limite = 50) {
    await this.buscar(u, id);
    return this.eventos.find({
      where: { unidadeId: id, empresaId: u.empresaId },
      order: { criadoEm: 'DESC' },
      take: Math.min(Math.max(limite, 1), 500),
    });
  }

  async desativar(u: UsuarioToken, id: string) {
    const unidade = await this.buscar(u, id);
    if (['ocupada', 'conta_entregue'].includes(unidade.status)
      || (await this.estadias.exists({ where: { unidadeId: unidade.id, status: In(['aberta', 'conta_entregue']) } }))) {
      throw new BadRequestException('Não é possível desativar uma unidade ocupada.');
    }
    await this.repo.update({ id }, { ativo: false });
    return { ok: true };
  }
}
