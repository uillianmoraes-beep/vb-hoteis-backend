import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Funcionario, FuncionarioLancamento, Revisao } from './funcionario.entity';
import { ConfigRevisaoDto, FuncionarioDto, LancamentoFuncDto, RevisaoDto } from './funcionarios.dto';
import { UsuarioToken } from '../common/permissoes';

const c = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const r = (x: number) => Math.round(x) / 100;
const DIA = 86_400_000;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const ITENS_REVISAO_PADRAO = [
  'Cama arrumada e enxoval completo', 'Banheiro limpo (box, vaso, pia)', 'Toalhas repostas', 'Amenities repostos',
  'Frigobar conferido e reposto', 'Lixo retirado', 'Piso e espelhos limpos', 'Ar, TV e luzes funcionando', 'Hidro/sauna limpa (se tiver)',
];

@Injectable()
export class FuncionariosService {
  constructor(
    @InjectRepository(Funcionario) private readonly repo: Repository<Funcionario>,
    @InjectRepository(FuncionarioLancamento) private readonly lancs: Repository<FuncionarioLancamento>,
    @InjectRepository(Revisao) private readonly revisoes: Repository<Revisao>,
    private readonly ds: DataSource,
  ) {}

  async listar(u: UsuarioToken, filtro: { funcao?: string; ambienteId?: string; todos?: boolean }) {
    const lista = await this.repo.find({ where: filtro.todos ? { empresaId: u.empresaId } : { empresaId: u.empresaId, ativo: true }, order: { nome: 'ASC' } });
    const funcoes = filtro.funcao ? filtro.funcao.split(',') : null;
    return lista.filter((f) => (!funcoes || funcoes.includes(f.funcao)) && (!filtro.ambienteId || !f.ambienteIds.length || f.ambienteIds.includes(filtro.ambienteId)));
  }

  private async buscar(u: UsuarioToken, id: string) {
    const f = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    return f;
  }

  async foto(u: UsuarioToken, id: string) {
    const f = await this.repo.createQueryBuilder('f').addSelect('f.foto').where('f.id = :id AND f.empresaId = :e', { id, e: u.empresaId }).getOne();
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    return { ...f };
  }

  private dados(dto: FuncionarioDto) {
    const d: Partial<Funcionario> = {
      nome: dto.nome.trim(), funcao: dto.funcao as Funcionario['funcao'], ambienteIds: dto.ambienteIds ?? [],
      telefone: dto.telefone?.trim() || null, documento: dto.documento?.trim() || null, chavePix: dto.chavePix?.trim() || null,
      admissao: dto.admissao || null, usuarioId: dto.usuarioId || null, recebeGorjeta: !!dto.recebeGorjeta,
      observacao: dto.observacao?.trim() || null, ativo: dto.ativo ?? true,
    };
    if (dto.foto !== undefined) {
      if (dto.foto && !/^data:image\/(jpeg|png|webp);base64,/.test(dto.foto)) throw new BadRequestException('Foto inválida.');
      d.foto = dto.foto || null;
    }
    return d;
  }

  async criar(u: UsuarioToken, dto: FuncionarioDto) {
    return this.ds.transaction(async (m) => {
      const res = await m.query('UPDATE empresas SET ultima_matricula = ultima_matricula + 1 WHERE id = $1 RETURNING ultima_matricula', [u.empresaId]);
      const linha = Array.isArray(res?.[0]) ? res[0][0] : res?.[0];
      const f = m.create(Funcionario, { empresaId: u.empresaId, matricula: Number(linha?.ultima_matricula ?? 1), ...this.dados(dto) });
      const salvo = await m.save(f);
      return { ...salvo, foto: undefined };
    });
  }

  async atualizar(u: UsuarioToken, id: string, dto: FuncionarioDto) {
    const f = await this.buscar(u, id);
    await this.repo.update({ id: f.id }, this.dados(dto));
    return this.buscar(u, id);
  }

  /* ---------- ficha financeira ---------- */

  async ficha(u: UsuarioToken, id: string, filtro: { de?: string; ate?: string }) {
    const f = await this.buscar(u, id);
    const ate = filtro.ate || hojeSP();
    const de = filtro.de || new Date(Date.now() - 30 * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const todos = await this.lancs.find({ where: { funcionarioId: f.id }, order: { data: 'DESC', criadoEm: 'DESC' } });
    const soma = (tipo: string) => todos.filter((l) => l.tipo === tipo).reduce((s, l) => s + c(l.valor), 0);
    const ids = [f.id, ...(f.usuarioId ? [f.usuarioId] : [])];
    const gorjetas: { id: string; criado_em: Date; forma: string; valor: string; valor_liquido: string; status: string; repassada_em: Date | null }[] =
      await this.ds.query(`SELECT id, criado_em, forma, valor, valor_liquido, status, repassada_em FROM gorjetas WHERE empresa_id = $1 AND beneficiario_id = ANY($2::uuid[]) ORDER BY criado_em DESC LIMIT 2000`, [u.empresaId, ids]);
    const ini = new Date(`${de}T00:00:00-03:00`);
    const fim = new Date(`${ate}T23:59:59.999-03:00`);
    const gPeriodo = gorjetas.filter((g) => new Date(g.criado_em) >= ini && new Date(g.criado_em) <= fim);
    const aRepassar = gorjetas.filter((g) => g.status === 'a_repassar').reduce((s, g) => s + c(g.valor_liquido), 0);
    // saldo: positivo = a casa deve ao funcionário; negativo = ele deve à casa
    const saldo = soma('bonus') - soma('vale') - soma('desconto') - soma('pagamento') + aRepassar;
    return {
      funcionario: f,
      periodo: { de, ate },
      totais: {
        vales: r(soma('vale')), descontos: r(soma('desconto')), bonus: r(soma('bonus')), pagamentos: r(soma('pagamento')),
        gorjetasAReceber: r(aRepassar),
        gorjetasNoPeriodo: r(gPeriodo.reduce((s, g) => s + c(g.valor), 0)),
        saldo: r(saldo),
      },
      lancamentos: todos.filter((l) => l.data >= de && l.data <= ate).map((l) => ({ ...l, valor: Number(l.valor) })),
      gorjetas: gPeriodo.map((g) => ({ id: g.id, criadoEm: g.criado_em, forma: g.forma, valor: Number(g.valor), liquido: Number(g.valor_liquido), status: g.status, repassadaEm: g.repassada_em })),
    };
  }

  async lancar(u: UsuarioToken, id: string, dto: LancamentoFuncDto) {
    const f = await this.buscar(u, id);
    await this.ds.transaction(async (m) => {
      await m.insert(FuncionarioLancamento, {
        empresaId: u.empresaId, funcionarioId: f.id, tipo: dto.tipo, valor: dto.valor.toFixed(2),
        descricao: dto.descricao?.trim() || null, data: dto.data, usuarioNome: u.nome,
      });
      // vale ou pagamento entregue em dinheiro/pix sai do caixa ADM
      if ((dto.tipo === 'vale' || dto.tipo === 'pagamento') && dto.saidaCaixa && dto.saidaCaixa !== 'nenhum') {
        await m.query(
          `INSERT INTO caixa_movimentos (empresa_id, turno_id, caixa, tipo, forma, valor, descricao, usuario_id, usuario_nome) VALUES ($1, NULL, 'adm', 'saida', $2, $3, $4, $5, $6)`,
          [u.empresaId, dto.saidaCaixa, dto.valor.toFixed(2), `${dto.tipo === 'vale' ? 'Vale' : 'Pagamento'} · ${f.nome}${dto.descricao?.trim() ? ` · ${dto.descricao.trim()}` : ''}`, u.sub, u.nome],
        );
      }
    });
    return this.ficha(u, id, {});
  }

  async removerLancamento(u: UsuarioToken, id: string, lancId: string) {
    const l = await this.lancs.findOne({ where: { id: lancId, funcionarioId: id, empresaId: u.empresaId } });
    if (!l) throw new NotFoundException('Lançamento não encontrado.');
    await this.lancs.delete({ id: l.id });
    return this.ficha(u, id, {});
  }

  /* ---------- revisão completa (governança) ---------- */

  async itensRevisao(u: UsuarioToken) {
    const [e] = await this.ds.query('SELECT config_revisao FROM empresas WHERE id = $1', [u.empresaId]);
    const l = Array.isArray(e?.config_revisao) && e.config_revisao.length ? e.config_revisao : ITENS_REVISAO_PADRAO;
    return { itens: l as string[] };
  }

  async salvarItensRevisao(u: UsuarioToken, dto: ConfigRevisaoDto) {
    const l = [...new Set(dto.itens.map((x) => x.trim()).filter(Boolean))];
    await this.ds.query('UPDATE empresas SET config_revisao = $2::jsonb WHERE id = $1', [u.empresaId, JSON.stringify(l)]);
    return this.itensRevisao(u);
  }

  /** Aprovada (tudo ok) → suíte livre. Reprovada → volta para limpeza com o que faltou. */
  async revisar(u: UsuarioToken, dto: RevisaoDto) {
    const [un] = await this.ds.query('SELECT id, codigo, status FROM unidades WHERE id = $1 AND empresa_id = $2', [dto.unidadeId, u.empresaId]);
    if (!un) throw new NotFoundException('Suíte não encontrada.');
    if (un.status !== 'vistoria' && un.status !== 'limpeza') throw new BadRequestException('A revisão é feita depois da limpeza (suíte em limpeza ou vistoria).');
    const aprovada = dto.itens.every((i) => i.ok);
    const falhas = dto.itens.filter((i) => !i.ok).map((i) => i.item);
    const novo = aprovada ? 'livre' : 'limpeza';
    const obsStatus = aprovada ? null : `Refazer: ${falhas.join(', ')}`.slice(0, 300);
    await this.ds.transaction(async (m) => {
      await m.insert(Revisao, {
        empresaId: u.empresaId, unidadeId: un.id, camareiraId: dto.camareiraId || null, camareiraNome: dto.camareiraNome?.trim() || null,
        revisorNome: u.nome, itens: dto.itens, aprovada, nota: dto.nota ?? null, observacao: dto.observacao?.trim() || null,
      });
      await m.query('UPDATE unidades SET status = $2, status_desde = now(), motivo_bloqueio_id = NULL, observacao_status = $3 WHERE id = $1', [un.id, novo, obsStatus]);
      await m.query(
        `INSERT INTO unidade_eventos (empresa_id, unidade_id, status_anterior, status_novo, observacao, usuario_id, usuario_nome) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [u.empresaId, un.id, un.status, novo, aprovada ? `Revisão aprovada${dto.camareiraNome ? ` · camareira ${dto.camareiraNome}` : ''}` : `Revisão reprovada: ${falhas.join(', ')}`.slice(0, 500), u.sub, u.nome],
      );
    });
    return { aprovada, status: novo, falhas };
  }

  async relatorioRevisoes(u: UsuarioToken, filtro: { de?: string; ate?: string }) {
    const ate = filtro.ate || hojeSP();
    const de = filtro.de || new Date(Date.now() - 30 * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const lista: (Revisao & { codigo: string })[] = await this.ds.query(
      `SELECT r.*, u.codigo FROM revisoes r LEFT JOIN unidades u ON u.id = r.unidade_id WHERE r.empresa_id = $1 AND r.criado_em BETWEEN $2 AND $3 ORDER BY r.criado_em DESC LIMIT 2000`,
      [u.empresaId, new Date(`${de}T00:00:00-03:00`), new Date(`${ate}T23:59:59.999-03:00`)],
    );
    const porCamareira = new Map<string, { nome: string; total: number; aprovadas: number; somaNota: number; comNota: number }>();
    for (const x of lista) {
      const nome = (x as unknown as { camareira_nome: string | null }).camareira_nome || 'Sem camareira';
      const a = porCamareira.get(nome) ?? { nome, total: 0, aprovadas: 0, somaNota: 0, comNota: 0 };
      a.total += 1;
      if (x.aprovada) a.aprovadas += 1;
      if (x.nota) { a.somaNota += x.nota; a.comNota += 1; }
      porCamareira.set(nome, a);
    }
    return {
      periodo: { de, ate },
      porCamareira: [...porCamareira.values()].map((a) => ({ nome: a.nome, total: a.total, aprovadas: a.aprovadas, pctAprovadas: Math.round((a.aprovadas / a.total) * 100), notaMedia: a.comNota ? Math.round((a.somaNota / a.comNota) * 10) / 10 : null }))
        .sort((x, y) => y.total - x.total),
      lista: lista.map((x) => {
        const y = x as unknown as Record<string, unknown>;
        return { id: y.id, codigo: y.codigo, camareira: y.camareira_nome, revisor: y.revisor_nome, aprovada: y.aprovada, nota: y.nota, observacao: y.observacao, itens: y.itens, criadoEm: y.criado_em };
      }),
    };
  }
}
