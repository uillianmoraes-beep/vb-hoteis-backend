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
  AtualizarUnidadeDto, CriarUnidadeDto, CriarUnidadesLoteDto, MoverUnidadesDto, MudarStatusDto,
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

  /**
   * A categoria tem que ser do ambiente da unidade. Categoria ainda sem ambiente passa a ser deste
   * (é a primeira vez que ela é usada).
   */
  private async validarCategoria(empresaId: string, categoriaId: string | null | undefined, ambienteId: string) {
    if (!categoriaId) return;
    const [c] = await this.ds.query(
      `SELECT c.nome, c.ambiente_id, a.nome AS ambiente FROM categorias c LEFT JOIN ambientes a ON a.id = c.ambiente_id
        WHERE c.id = $1 AND c.empresa_id = $2 AND c.ativo`, [categoriaId, empresaId]);
    if (!c) throw new BadRequestException('Categoria inválida.');
    if (!c.ambiente_id) await this.ds.query(`UPDATE categorias SET ambiente_id = $2 WHERE id = $1`, [categoriaId, ambienteId]);
    else if (c.ambiente_id !== ambienteId) throw new BadRequestException(`A categoria ${c.nome} é do ${c.ambiente}. Escolha uma categoria deste ambiente.`);
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
    await this.validarCategoria(u.empresaId, dto.categoriaId, dto.ambienteId);
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
    await this.validarCategoria(u.empresaId, dto.categoriaId, dto.ambienteId);

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
    // mudou de ambiente sem dizer a categoria: a do ambiente antigo sai
    const ambienteNovo = dto.ambientePadraoId ?? dto.ambienteId ?? unidade.ambientePadraoId;
    if (dto.categoriaId === undefined && ambienteNovo !== unidade.ambientePadraoId && unidade.categoriaId) dto.categoriaId = null;
    if (dto.categoriaId) await this.validarCategoria(u.empresaId, dto.categoriaId, ambienteNovo);

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

  /** muda ambiente / tipo / categoria de várias unidades de uma vez (não mexe nas que têm conta aberta) */
  async mover(u: UsuarioToken, dto: MoverUnidadesDto) {
    if (!dto.ambienteId && !dto.tipo && !dto.categoriaId) throw new BadRequestException('Escolha o que mudar.');
    if (dto.ambienteId) await this.validarAmbiente(u.empresaId, dto.ambienteId);
    const lista = await this.repo.find({ where: { empresaId: u.empresaId, id: In(dto.ids) } });
    if (dto.categoriaId) {
      const destinos = new Set(dto.ambienteId ? [dto.ambienteId] : lista.map((x) => x.ambientePadraoId));
      if (destinos.size > 1) throw new BadRequestException('As unidades escolhidas são de ambientes diferentes: mude a categoria de um ambiente por vez.');
      await this.validarCategoria(u.empresaId, dto.categoriaId, [...destinos][0]);
    }
    const comConta: string[] = [];
    let n = 0;
    for (const un of lista) {
      if (dto.ambienteId && un.ambienteId !== dto.ambienteId
        && (await this.estadias.exists({ where: { unidadeId: un.id, status: In(['aberta', 'conta_entregue']) } }))) {
        comConta.push(un.codigo);
        continue;
      }
      const mud: Partial<Unidade> = {};
      if (dto.ambienteId) {
        mud.ambienteId = dto.ambienteId;
        mud.ambientePadraoId = dto.ambienteId;
        // a categoria do ambiente antigo não vale no novo
        if (!dto.categoriaId && un.ambientePadraoId !== dto.ambienteId) mud.categoriaId = null;
      }
      if (dto.tipo) mud.tipo = dto.tipo;
      if (dto.categoriaId) mud.categoriaId = dto.categoriaId;
      await this.repo.update({ id: un.id }, mud);
      n++;
    }
    return { alteradas: n, comConta };
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
    if (novo === 'paga') throw new BadRequestException('A suíte fica paga só pelo fechamento da conta.');
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
        // a camareira da limpeza continua indicada na vistoria (para a revisão)
        observacaoStatus: dto.observacao ?? (atual === 'limpeza' && novo === 'vistoria' && unidade.observacaoStatus?.startsWith('Camareira:') ? unidade.observacaoStatus : null),
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

  async definirResponsavel(u: UsuarioToken, id: string, nome: string) {
    const unidade = await this.buscar(u, id);
    if (!['limpeza', 'vistoria'].includes(unidade.status)) throw new BadRequestException('Só dá para indicar responsável em limpeza ou vistoria.');
    const limpo = nome.trim().slice(0, 60);
    const papel = 'Camareira';
    const obs = limpo ? `${papel}: ${limpo}` : null;
    await this.ds.transaction(async (m) => {
      await m.update(Unidade, { id: unidade.id }, { observacaoStatus: obs });
      await m.insert(UnidadeEvento, {
        empresaId: u.empresaId, unidadeId: unidade.id, statusAnterior: unidade.status, statusNovo: unidade.status,
        motivoBloqueioId: null, observacao: obs ?? `Sem ${papel.toLowerCase()}`, usuarioId: u.sub, usuarioNome: u.nome,
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
