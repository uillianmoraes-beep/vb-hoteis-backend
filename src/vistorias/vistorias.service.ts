import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken, temPermissao } from '../common/permissoes';
import { moduloAtivo } from '../common/modulos';
import { ManutencaoService } from '../manutencao/manutencao.service';
import { ITENS_REVISAO_PADRAO } from '../funcionarios/funcionarios.service';
import { FotosService } from './fotos.service';
import { ConfigVistoriaDto, DecisaoDto, VistoriaDto } from './vistorias.dto';

export interface ConfigVistoria { checklist: string[]; fotos: string[]; diasSemVistoria: number; validadeAvisoDias: number }

export const CONFIG_PADRAO: ConfigVistoria = {
  checklist: ITENS_REVISAO_PADRAO, fotos: ['Quarto', 'Banheiro', 'Frigobar'], diasSemVistoria: 7, validadeAvisoDias: 15,
};

export function lerConfig(bruto: unknown): ConfigVistoria {
  const c = (bruto ?? {}) as Partial<ConfigVistoria>;
  return {
    checklist: Array.isArray(c.checklist) ? c.checklist : CONFIG_PADRAO.checklist,
    fotos: Array.isArray(c.fotos) ? c.fotos : CONFIG_PADRAO.fotos,
    diasSemVistoria: Number.isInteger(c.diasSemVistoria) ? c.diasSemVistoria! : CONFIG_PADRAO.diasSemVistoria,
    validadeAvisoDias: Number.isInteger(c.validadeAvisoDias) ? c.validadeAvisoDias! : CONFIG_PADRAO.validadeAvisoDias,
  };
}

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESULTADO: Record<string, string> = { aprovado: 'Aprovado', ressalva: 'Com ressalva', reprovado: 'Reprovado' };
const limpa = (l: string[]) => [...new Set(l.map((x) => x.trim()).filter(Boolean))];

export interface FiltroVistorias { de?: string; ate?: string; ambienteId?: string; unidadeId?: string; usuario?: string; resultado?: string }

@Injectable()
export class VistoriasService {
  constructor(private readonly ds: DataSource, private readonly fotos: FotosService, private readonly manutencao: ManutencaoService) {}

  private podeVer(u: UsuarioToken, ambienteId: string | null) {
    return !ambienteId || !u.ambientesIds || u.ambientesIds.length === 0 || u.ambientesIds.includes(ambienteId);
  }

  /** o app de manutenção só aparece se a empresa contratou e ligou a integração */
  private async temManutencao(empresaId: string) {
    const [e] = await this.ds.query(`SELECT modulos FROM empresas WHERE id = $1`, [empresaId]);
    return moduloAtivo(e?.modulos, 'manutencao') && (await this.manutencao.ativa(empresaId));
  }

  /* ---------- cadastros (por ambiente) ---------- */

  async config(u: UsuarioToken, ambienteId: string) {
    const [a] = await this.ds.query(`SELECT id, nome, tipo, config_vistoria FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    const [e] = await this.ds.query(`SELECT fotos_dias FROM empresas WHERE id = $1`, [u.empresaId]);
    return {
      ambiente: { id: a.id, nome: a.nome, tipo: a.tipo }, ...lerConfig(a.config_vistoria), fotosDias: Number(e?.fotos_dias ?? 180),
      pastaFotos: !!this.fotos.pasta, manutencao: await this.temManutencao(u.empresaId),
    };
  }

  async salvarConfig(u: UsuarioToken, ambienteId: string, dto: ConfigVistoriaDto) {
    const [a] = await this.ds.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, u.empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    const cfg: ConfigVistoria = { checklist: limpa(dto.checklist), fotos: limpa(dto.fotos), diasSemVistoria: dto.diasSemVistoria, validadeAvisoDias: dto.validadeAvisoDias };
    await this.ds.query(`UPDATE ambientes SET config_vistoria = $2::jsonb WHERE id = $1`, [ambienteId, JSON.stringify(cfg)]);
    if (dto.fotosDias) await this.ds.query(`UPDATE empresas SET fotos_dias = $2 WHERE id = $1`, [u.empresaId, dto.fotosDias]);
    return this.config(u, ambienteId);
  }

  /* ---------- tela da vistoria ---------- */

  /** o que está esperando: unidades em limpeza/vistoria, reprovadas aguardando o adm e ressalvas abertas */
  async pendentes(u: UsuarioToken, ambienteId?: string) {
    const p: unknown[] = [u.empresaId];
    let filtro = '';
    if (ambienteId) { p.push(ambienteId); filtro = ` AND un.ambiente_id = $${p.length}`; }
    else if (u.ambientesIds?.length) { p.push(u.ambientesIds); filtro = ` AND un.ambiente_id = ANY($${p.length}::uuid[])`; }
    const unidades = await this.ds.query(
      `SELECT un.id, un.codigo, un.tipo, un.status, un.status_desde, un.observacao_status, un.ambiente_id, a.nome AS ambiente, c.nome AS categoria,
              un.vistoria_resultado, un.vistoria_em
         FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.empresa_id = $1 AND un.ativo AND un.status IN ('limpeza','vistoria')${filtro}
        ORDER BY un.status DESC, un.status_desde`, p);
    const abertas = await this.ds.query(
      `SELECT v.id, v.unidade_id, v.unidade_codigo, v.resultado, v.decisao, v.camareira_nome, v.vistoriadora_nome, v.observacao, v.avaria, v.itens, v.criado_em, a.nome AS ambiente
         FROM vistorias v JOIN unidades un ON un.id = v.unidade_id LEFT JOIN ambientes a ON a.id = v.ambiente_id
        WHERE v.empresa_id = $1 AND ((v.resultado = 'reprovado' AND v.decisao = 'pendente') OR (v.resultado = 'ressalva' AND v.ciente_em IS NULL))${filtro}
        ORDER BY v.criado_em DESC LIMIT 200`, p);
    return {
      unidades: unidades.map((x: Record<string, unknown>) => ({
        id: x.id, codigo: x.codigo, tipo: x.tipo, status: x.status, statusDesde: x.status_desde, ambienteId: x.ambiente_id, ambiente: x.ambiente,
        categoria: x.categoria, camareira: String(x.observacao_status ?? '').startsWith('Camareira:') ? String(x.observacao_status).slice(10).trim() : null,
        observacao: x.observacao_status, ultimaVistoria: x.vistoria_resultado ? { resultado: x.vistoria_resultado, em: x.vistoria_em } : null,
      })),
      reprovadas: abertas.filter((v: { resultado: string }) => v.resultado === 'reprovado').map(this.resumo),
      ressalvas: abertas.filter((v: { resultado: string }) => v.resultado === 'ressalva').map(this.resumo),
      manutencao: await this.temManutencao(u.empresaId),
    };
  }

  private resumo = (v: Record<string, unknown>) => ({
    id: v.id, unidadeId: v.unidade_id, unidade: v.unidade_codigo, ambiente: v.ambiente, resultado: v.resultado, camareira: v.camareira_nome,
    vistoriadora: v.vistoriadora_nome, observacao: v.observacao, avaria: v.avaria,
    problemas: ((v.itens as { item: string; ok: boolean }[]) ?? []).filter((i) => !i.ok).map((i) => i.item), criadoEm: v.criado_em,
  });

  /** dados para o formulário: checklist e fotos do ambiente, frigobar da categoria e o que foi vendido desde a última vistoria */
  async preparar(u: UsuarioToken, unidadeId: string) {
    const [un] = await this.ds.query(
      `SELECT un.id, un.codigo, un.tipo, un.status, un.categoria_id, un.observacao_status, un.ambiente_id, un.frigobar_validade,
              a.nome AS ambiente, a.config_vistoria, c.nome AS categoria
         FROM unidades un JOIN ambientes a ON a.id = un.ambiente_id LEFT JOIN categorias c ON c.id = un.categoria_id
        WHERE un.id = $1 AND un.empresa_id = $2`, [unidadeId, u.empresaId]);
    if (!un) throw new NotFoundException('Unidade não encontrada.');
    if (!this.podeVer(u, un.ambiente_id)) throw new ForbiddenException('Unidade de outro ambiente.');
    const [ultima] = await this.ds.query(`SELECT criado_em, vistoriadora_nome, resultado FROM vistorias WHERE unidade_id = $1 ORDER BY criado_em DESC LIMIT 1`, [un.id]);
    const frigobar = un.categoria_id ? await this.ds.query(
      `SELECT p.id, p.nome, fc.quantidade FROM frigobar_categoria fc JOIN produtos p ON p.id = fc.produto_id
        WHERE fc.categoria_id = $1 AND p.ativo ORDER BY p.nome`, [un.categoria_id]) : [];
    const vendidos = await this.vendidosDesde(un.id, ultima?.criado_em ?? null, frigobar.map((f: { id: string }) => f.id));
    const camareiras = await this.ds.query(
      `SELECT id, nome FROM funcionarios WHERE empresa_id = $1 AND ativo AND funcao IN ('camareira','governanta')
          AND (jsonb_array_length(ambiente_ids) = 0 OR ambiente_ids ? $2) ORDER BY nome`, [u.empresaId, un.ambiente_id]);
    return {
      unidade: { id: un.id, codigo: un.codigo, tipo: un.tipo, status: un.status, ambienteId: un.ambiente_id, ambiente: un.ambiente, categoria: un.categoria },
      camareira: String(un.observacao_status ?? '').startsWith('Camareira:') ? String(un.observacao_status).slice(10).trim() : null,
      camareiras,
      config: lerConfig(un.config_vistoria),
      frigobar: frigobar.map((f: { id: string; nome: string; quantidade: number }) => ({ produtoId: f.id, nome: f.nome, padrao: Number(f.quantidade), vendidos: vendidos.get(f.id) ?? 0 })),
      frigobarValidade: un.frigobar_validade ? String(un.frigobar_validade instanceof Date ? un.frigobar_validade.toISOString() : un.frigobar_validade).slice(0, 10) : null,
      ultima: ultima ? { em: ultima.criado_em, por: ultima.vistoriadora_nome, resultado: ultima.resultado } : null,
      manutencao: await this.temManutencao(u.empresaId),
      pastaFotos: !!this.fotos.pasta,
    };
  }

  /** produtos do frigobar lançados nas contas desta unidade desde a última vistoria */
  private async vendidosDesde(unidadeId: string, desde: Date | null, produtoIds: string[]) {
    const m = new Map<string, number>();
    if (!produtoIds.length) return m;
    const l: { produto_id: string; q: string }[] = await this.ds.query(
      `SELECT i.produto_id, SUM(i.quantidade) AS q FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id
        WHERE e.unidade_id = $1 AND i.status = 'ativo' AND i.produto_id = ANY($2::uuid[]) AND i.criado_em > COALESCE($3::timestamptz, now() - interval '7 days')
        GROUP BY i.produto_id`, [unidadeId, produtoIds, desde]);
    for (const x of l) m.set(x.produto_id, Number(x.q));
    return m;
  }

  async registrar(u: UsuarioToken, dto: VistoriaDto) {
    const prep = await this.preparar(u, dto.unidadeId);
    const un = prep.unidade;
    if (!['limpeza', 'vistoria'].includes(un.status)) throw new BadRequestException(`A ${un.codigo} não está em limpeza nem em vistoria (está ${un.status}).`);
    // fotos obrigatórias do ambiente: não finaliza sem todas
    const faltam = prep.config.fotos.filter((l) => !dto.fotos.some((f) => f.local === l));
    if (faltam.length) throw new BadRequestException(`Faltam as fotos: ${faltam.join(', ')}.`);
    const fotoIds = [...dto.fotos.map((f) => f.fotoId), ...(dto.avariaFotoIds ?? [])];
    await this.fotos.conferir(u.empresaId, fotoIds);
    const problemas = dto.itens.filter((i) => !i.ok).map((i) => i.item);
    if (dto.resultado !== 'aprovado' && !problemas.length && !dto.observacao?.trim() && !dto.avaria?.trim()) {
      throw new BadRequestException('Diga o que está errado: marque os itens com problema ou escreva a observação.');
    }
    if (dto.chamado && !dto.avaria?.trim()) throw new BadRequestException('Descreva a avaria para abrir o chamado.');
    // conferência do frigobar: reposto x vendido nas contas desde a última vistoria
    const nomes = new Map<string, { nome: string; vendidos: number }>(prep.frigobar.map((f: { produtoId: string; nome: string; vendidos: number }) => [f.produtoId, f]));
    const reposicao = dto.reposicao.filter((r) => r.quantidade > 0).map((r) => {
      const f = nomes.get(r.produtoId);
      const vendidos = f?.vendidos ?? 0;
      return { produtoId: r.produtoId, nome: f?.nome ?? 'Produto', quantidade: r.quantidade, vendidos, semCobranca: Math.max(0, r.quantidade - vendidos) };
    });
    const semCobranca = reposicao.filter((r) => r.semCobranca > 0);
    const reprovado = dto.resultado === 'reprovado';
    const novoStatus = reprovado ? 'vistoria' : 'livre';
    const obsStatus = reprovado ? `Reprovada na vistoria: ${[...problemas, dto.observacao?.trim()].filter(Boolean).join(', ')} · aguardando o adm`.slice(0, 300)
      : dto.resultado === 'ressalva' ? `Liberada com ressalva: ${[...problemas, dto.observacao?.trim()].filter(Boolean).join(', ')}`.slice(0, 300) : null;
    const camareira = dto.camareiraNome?.trim() || prep.camareira || null;

    const id = await this.ds.transaction(async (m) => {
      const [v] = await m.query(
        `INSERT INTO vistorias (empresa_id, ambiente_id, unidade_id, unidade_codigo, camareira_id, camareira_nome, vistoriadora_id, vistoriadora_nome, resultado,
           itens, reposicao, frigobar_validade, avaria, observacao, decisao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15) RETURNING id`,
        [u.empresaId, un.ambienteId, un.id, un.codigo, dto.camareiraId || null, camareira, u.sub, u.nome, dto.resultado,
          JSON.stringify(dto.itens), JSON.stringify(reposicao), dto.frigobarValidade || null, dto.avaria?.trim() || null, dto.observacao?.trim() || null,
          reprovado ? 'pendente' : null]);
      for (const f of dto.fotos) await m.query(`UPDATE fotos SET local = $3 WHERE id = $1 AND empresa_id = $2`, [f.fotoId, u.empresaId, f.local.slice(0, 60)]);
      await this.fotos.vincular(m, u.empresaId, dto.fotos.map((f) => f.fotoId), v.id);
      if (dto.avariaFotoIds?.length) {
        await m.query(`UPDATE fotos SET origem = 'avaria', local = 'Avaria' WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, dto.avariaFotoIds]);
        await this.fotos.vincular(m, u.empresaId, dto.avariaFotoIds, v.id);
      }
      // a revisão da camareira continua contando no relatório de desempenho
      await m.query(
        `INSERT INTO revisoes (empresa_id, unidade_id, camareira_id, camareira_nome, revisor_nome, itens, aprovada, observacao) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [u.empresaId, un.id, dto.camareiraId || null, camareira, u.nome, JSON.stringify(dto.itens), !reprovado, (dto.observacao?.trim() || null)?.slice(0, 500) ?? null]);
      await m.query(
        `UPDATE unidades SET vistoria_resultado = $2, vistoria_em = now(), frigobar_validade = COALESCE($3::date, frigobar_validade),
           status = $4, status_desde = CASE WHEN status = $4 THEN status_desde ELSE now() END, motivo_bloqueio_id = NULL, observacao_status = $5
         WHERE id = $1`, [un.id, dto.resultado, dto.frigobarValidade || null, novoStatus, obsStatus]);
      await m.query(
        `INSERT INTO unidade_eventos (empresa_id, unidade_id, status_anterior, status_novo, observacao, usuario_id, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [u.empresaId, un.id, un.status, novoStatus,
          `Vistoria: ${RESULTADO[dto.resultado]}${camareira ? ` · camareira ${camareira}` : ''}${problemas.length ? ` · ${problemas.join(', ')}` : ''}`.slice(0, 500), u.sub, u.nome]);
      return v.id as string;
    });

    // avaria: chamado no app de manutenção (se contratado); falha não desfaz a vistoria
    let aviso: string | null = null;
    if (dto.chamado && prep.manutencao) {
      try {
        const ch = await this.manutencao.abrir(u, { area: dto.chamado.area, unidadeId: un.id, descricao: (dto.chamado.descricao?.trim() || dto.avaria!.trim()).slice(0, 2000) });
        await this.ds.query(`UPDATE vistorias SET chamado_id = $2 WHERE id = $1`, [id, ch.id]);
      } catch (e) {
        aviso = e instanceof Error ? e.message : 'Não consegui abrir o chamado.';
      }
    }
    return {
      ok: true, id, resultado: dto.resultado, status: novoStatus, aviso,
      semCobranca: semCobranca.map((r) => ({ nome: r.nome, quantidade: r.semCobranca })),
    };
  }

  /** reprovada: o adm manda de volta para a limpeza ou bloqueia para a manutenção */
  async decidir(u: UsuarioToken, id: string, dto: DecisaoDto) {
    const [v] = await this.ds.query(`SELECT * FROM vistorias WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!v) throw new NotFoundException('Vistoria não encontrada.');
    if (v.decisao !== 'pendente') throw new BadRequestException('Esta vistoria já foi decidida.');
    const [un] = await this.ds.query(`SELECT id, codigo, status, ambiente_id FROM unidades WHERE id = $1`, [v.unidade_id]);
    if (!un) throw new NotFoundException('Unidade não encontrada.');
    if (!this.podeVer(u, un.ambiente_id)) throw new ForbiddenException('Unidade de outro ambiente.');
    if (un.status !== 'vistoria') throw new BadRequestException(`A ${un.codigo} já saiu da vistoria (está ${un.status}).`);
    const problemas = ((v.itens ?? []) as { item: string; ok: boolean }[]).filter((i) => !i.ok).map((i) => i.item);
    let motivo: { id: string; nome: string } | null = null;
    if (dto.destino === 'manutencao') {
      if (!temPermissao(u, 'unidades.bloquear')) throw new ForbiddenException('Seu perfil não pode bloquear unidades.');
      const [mt] = dto.motivoBloqueioId
        ? await this.ds.query(`SELECT id, nome FROM motivos_bloqueio WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.motivoBloqueioId, u.empresaId])
        : await this.ds.query(`SELECT id, nome FROM motivos_bloqueio WHERE empresa_id = $1 AND ativo ORDER BY abre_manutencao DESC, ordem LIMIT 1`, [u.empresaId]);
      if (!mt) throw new BadRequestException('Escolha o motivo do bloqueio (cadastre em Motivos de bloqueio).');
      motivo = mt;
    }
    const novo = dto.destino === 'limpeza' ? 'limpeza' : 'bloqueada';
    const obs = (dto.destino === 'limpeza'
      ? `Refazer: ${[...problemas, v.observacao, dto.observacao?.trim()].filter(Boolean).join(', ')}`
      : `Manutenção: ${[v.avaria, ...problemas, dto.observacao?.trim()].filter(Boolean).join(', ')}`).slice(0, 300);
    await this.ds.transaction(async (m) => {
      await m.query(`UPDATE vistorias SET decisao = $2, decisao_motivo = $3, decidido_por = $4, decidido_em = now() WHERE id = $1`,
        [id, dto.destino, dto.observacao?.trim() || motivo?.nome || null, u.nome]);
      await m.query(`UPDATE unidades SET status = $2, status_desde = now(), motivo_bloqueio_id = $3, observacao_status = $4 WHERE id = $1`, [un.id, novo, motivo?.id ?? null, obs]);
      await m.query(
        `INSERT INTO unidade_eventos (empresa_id, unidade_id, status_anterior, status_novo, motivo_bloqueio_id, observacao, usuario_id, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [u.empresaId, un.id, un.status, novo, motivo?.id ?? null, `Vistoria reprovada · decisão: ${dto.destino === 'limpeza' ? 'volta para a limpeza' : `manutenção (${motivo?.nome})`}`, u.sub, u.nome]);
    });
    let aviso: string | null = null;
    if (dto.destino === 'manutencao' && dto.chamado) {
      if (!(await this.temManutencao(u.empresaId))) aviso = 'O app de manutenção não está contratado/ligado: a unidade foi bloqueada sem chamado.';
      else {
        try {
          const ch = await this.manutencao.abrir(u, { area: dto.chamado.area, unidadeId: un.id, descricao: (dto.chamado.descricao?.trim() || obs).slice(0, 2000) });
          await this.ds.query(`UPDATE vistorias SET chamado_id = $2 WHERE id = $1`, [id, ch.id]);
        } catch (e) { aviso = e instanceof Error ? e.message : 'Não consegui abrir o chamado.'; }
      }
    }
    return { ok: true, status: novo, aviso };
  }

  /** ressalva vista pelo responsável: sai dos avisos */
  async ciente(u: UsuarioToken, id: string) {
    const r = await this.ds.query(`UPDATE vistorias SET ciente_por = $3, ciente_em = now() WHERE id = $1 AND empresa_id = $2 AND resultado = 'ressalva' AND ciente_em IS NULL RETURNING id`, [id, u.empresaId, u.nome]);
    if (!r.length) throw new NotFoundException('Ressalva não encontrada ou já vista.');
    return { ok: true };
  }

  /* ---------- histórico, relatório e planilha ---------- */

  periodo(f: FiltroVistorias, maxDias = 62) {
    const ate = f.ate && DIA_RE.test(f.ate) ? f.ate : hojeSP();
    const de = f.de && DIA_RE.test(f.de) ? f.de : ate;
    if (de > ate) throw new BadRequestException('A data inicial é depois da final.');
    if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > maxDias) throw new BadRequestException(`Escolha no máximo ${maxDias} dias.`);
    return { de, ate };
  }

  async listar(u: UsuarioToken, f: FiltroVistorias, limite = 2000) {
    const { de, ate } = this.periodo(f);
    const p: unknown[] = [u.empresaId, new Date(`${de}T00:00:00-03:00`), new Date(`${ate}T23:59:59.999-03:00`)];
    const w: string[] = [];
    const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replaceAll('?', `$${p.length}`)); };
    if (f.ambienteId && /^[0-9a-f-]{36}$/i.test(f.ambienteId)) add('v.ambiente_id = ?', f.ambienteId);
    else if (u.ambientesIds?.length) add('v.ambiente_id = ANY(?::uuid[])', u.ambientesIds);
    if (f.unidadeId && /^[0-9a-f-]{36}$/i.test(f.unidadeId)) add('v.unidade_id = ?', f.unidadeId);
    if (f.resultado && RESULTADO[f.resultado]) add('v.resultado = ?', f.resultado);
    if (f.usuario?.trim()) add('(lower(v.vistoriadora_nome) LIKE ? OR lower(v.camareira_nome) LIKE ?)', `%${f.usuario.trim().toLowerCase()}%`);
    const l = await this.ds.query(
      `SELECT v.*, a.nome AS ambiente,
              (SELECT json_agg(json_build_object('id', ft.id, 'local', ft.local, 'origem', ft.origem) ORDER BY ft.criado_em) FROM fotos ft WHERE ft.referencia_id = v.id) AS fotos
         FROM vistorias v LEFT JOIN ambientes a ON a.id = v.ambiente_id
        WHERE v.empresa_id = $1 AND v.criado_em BETWEEN $2 AND $3${w.length ? ` AND ${w.join(' AND ')}` : ''}
        ORDER BY v.criado_em DESC LIMIT ${limite}`, p);
    const lista = l.map((v: Record<string, unknown>) => ({
      id: v.id, criadoEm: v.criado_em, ambiente: v.ambiente, unidadeId: v.unidade_id, unidade: v.unidade_codigo, camareira: v.camareira_nome,
      vistoriadora: v.vistoriadora_nome, resultado: v.resultado, itens: v.itens, reposicao: v.reposicao,
      frigobarValidade: v.frigobar_validade ? String(v.frigobar_validade instanceof Date ? (v.frigobar_validade as Date).toISOString() : v.frigobar_validade).slice(0, 10) : null,
      avaria: v.avaria, observacao: v.observacao, decisao: v.decisao, decididoPor: v.decidido_por, chamado: !!v.chamado_id,
      fotos: (v.fotos as { id: string; local: string | null; origem: string }[] | null) ?? [],
    }));
    // resumo por vistoriadora e por camareira
    const conta = (chave: 'vistoriadora' | 'camareira') => {
      const mp = new Map<string, { nome: string; total: number; aprovado: number; ressalva: number; reprovado: number }>();
      for (const v of lista) {
        const nome = (v[chave] as string | null) || '—';
        const x = mp.get(nome) ?? { nome, total: 0, aprovado: 0, ressalva: 0, reprovado: 0 };
        x.total++;
        x[v.resultado as 'aprovado' | 'ressalva' | 'reprovado']++;
        mp.set(nome, x);
      }
      return [...mp.values()].sort((a, b) => b.total - a.total);
    };
    return { periodo: { de, ate }, lista, porVistoriadora: conta('vistoriadora'), porCamareira: conta('camareira') };
  }

  async foto(u: UsuarioToken, id: string, mini: boolean) {
    return this.fotos.ler(u, id, mini);
  }
}
