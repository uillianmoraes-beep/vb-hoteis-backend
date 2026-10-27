import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AssinarRelatorioDto, KitDto, MovimentoEnxovalDto, NovoRelatorioDto, TipoEnxovalDto } from './enxoval.dto';
import { temPermissao, UsuarioToken } from '../common/permissoes';
import { urlFoto } from '../produtos/fotos';

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const imgOk = (s: string) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
const NOME_MOV: Record<string, string> = { compra: 'Compra', envio: 'Envio à lavanderia', retorno: 'Retorno da lavanderia', danificada: 'Danificada', extraviada: 'Extraviada', contagem: 'Contagem' };

interface ItemLote { tipoId: string; nome: string; quantidade: number; mediaNaCompra: number; custo: number }

@Injectable()
export class EnxovalService {
  constructor(private readonly ds: DataSource) {}

  async painel(u: UsuarioToken) {
    const tipos = await this.ds.query(`SELECT * FROM enxoval_tipos WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]);
    const kits = await this.ds.query(`SELECT categoria_id, tipo_id, quantidade FROM enxoval_kits WHERE empresa_id = $1`, [u.empresaId]);
    // quantas suítes de cada categoria → peças necessárias para uma rodada (1 kit por suíte)
    const suites = await this.ds.query(`SELECT categoria_id, count(*)::int AS n FROM unidades WHERE empresa_id = $1 AND ativo AND categoria_id IS NOT NULL GROUP BY categoria_id`, [u.empresaId]);
    const nCat = new Map<string, number>(suites.map((s: { categoria_id: string; n: number }) => [s.categoria_id, Number(s.n)]));
    const porRodada = new Map<string, number>();
    for (const k of kits) porRodada.set(k.tipo_id, (porRodada.get(k.tipo_id) ?? 0) + Number(k.quantidade) * (nCat.get(k.categoria_id) ?? 0));
    return {
      tipos: tipos.map((t: Record<string, unknown>) => {
        const total = Number(t.total);
        const emUso = Math.max(0, total - Number(t.rouparia) - Number(t.lavanderia));
        const media = total ? Number(t.lavagens) / total : 0;
        const rodada = porRodada.get(String(t.id)) ?? 0;
        return {
          id: t.id, nome: t.nome, fotoUrl: urlFoto(u.empresaId, t.foto as string | null), total, rouparia: Number(t.rouparia), lavanderia: Number(t.lavanderia), emUso, perdas: Number(t.perdas),
          lavagensMedia: Math.round(media), limiteLavagens: Number(t.limite_lavagens), vidaUsadaPct: Math.min(100, Math.round((media / Number(t.limite_lavagens)) * 100)),
          custo: Number(t.custo), porRodada: rodada, jogos: rodada ? Math.round((total / rodada) * 10) / 10 : null,
          custoLavagem: Number(t.custo_lavagem ?? 0), pesoKg: Number(t.peso_kg ?? 0),
        };
      }),
      kits: kits.map((k: Record<string, unknown>) => ({ categoriaId: k.categoria_id, tipoId: k.tipo_id, quantidade: Number(k.quantidade) })),
    };
  }

  async criarTipo(u: UsuarioToken, dto: TipoEnxovalDto) {
    await this.ds.query(`INSERT INTO enxoval_tipos (empresa_id, nome, limite_lavagens, custo, custo_lavagem, peso_kg) VALUES ($1,$2,$3,$4,$5,$6)`,
      [u.empresaId, dto.nome.trim(), dto.limiteLavagens ?? 240, (dto.custo ?? 0).toFixed(2), (dto.custoLavagem ?? 0).toFixed(2), dto.pesoKg ?? 0]);
    return this.painel(u);
  }

  async editarTipo(u: UsuarioToken, id: string, dto: TipoEnxovalDto) {
    await this.ds.query(`UPDATE enxoval_tipos SET nome = $3, limite_lavagens = $4, custo = $5, custo_lavagem = COALESCE($6, custo_lavagem), peso_kg = COALESCE($7, peso_kg) WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, dto.nome.trim(), dto.limiteLavagens ?? 240, (dto.custo ?? 0).toFixed(2), dto.custoLavagem === undefined ? null : dto.custoLavagem.toFixed(2), dto.pesoKg ?? null]);
    return this.painel(u);
  }

  async movimentar(u: UsuarioToken, dto: MovimentoEnxovalDto) {
    const itens = dto.itens.filter((i) => i.quantidade > 0 || dto.movimento === 'contagem');
    if (!itens.length) throw new BadRequestException('Informe as quantidades.');
    const fotos = (dto.fotos ?? []).filter(Boolean);
    if (fotos.some((f) => !imgOk(f))) throw new BadRequestException('Foto inválida.');
    if (dto.loteId) {
      const [l] = await this.ds.query(`SELECT id FROM enxoval_lotes WHERE id = $1 AND empresa_id = $2`, [dto.loteId, u.empresaId]);
      if (!l) throw new NotFoundException('Lote não encontrado.');
    }
    const usadas = dto.movimento === 'compra' && !!dto.usadas;
    const lavIni = usadas ? dto.lavagensIniciais ?? 0 : 0;
    let loteCriado: { id: string; codigo: string } | null = null;
    await this.ds.transaction(async (m) => {
      let loteId: string | null = dto.loteId ?? null;
      if (dto.movimento === 'compra') {
        // cada compra vira um lote com QR code
        const r = await m.query('UPDATE empresas SET ultimo_lote = ultimo_lote + 1 WHERE id = $1 RETURNING ultimo_lote', [u.empresaId]);
        const linha = Array.isArray(r?.[0]) ? r[0][0] : r?.[0];
        const numero = Number(linha?.ultimo_lote ?? 1);
        const codigo = `L${String(numero).padStart(4, '0')}`;
        const itensLote: ItemLote[] = [];
        for (const i of itens) {
          const [t] = await m.query(`SELECT id, nome, total, lavagens, custo FROM enxoval_tipos WHERE id = $1 AND empresa_id = $2`, [i.tipoId, u.empresaId]);
          if (!t) throw new NotFoundException('Tipo de peça não encontrado.');
          itensLote.push({ tipoId: t.id, nome: t.nome, quantidade: i.quantidade, mediaNaCompra: Number(t.total) ? Number(t.lavagens) / Number(t.total) : 0, custo: Number(t.custo) });
        }
        const [l] = await m.query(
          `INSERT INTO enxoval_lotes (empresa_id, numero, codigo, token, itens, usadas, lavagens_iniciais, meses_uso, data_compra, fornecedor, nota_fiscal, observacao, criado_por)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
          [u.empresaId, numero, codigo, randomBytes(12).toString('base64url'), JSON.stringify(itensLote), usadas, lavIni, usadas ? dto.mesesUso ?? null : null,
            dto.dataCompra ?? hojeSP(), dto.fornecedor?.trim() || null, dto.notaFiscal?.trim() || null, dto.observacao?.trim() || null, u.nome]);
        loteId = l.id;
        loteCriado = { id: l.id, codigo };
      }
      for (const i of itens) {
        const [t] = await m.query(`SELECT * FROM enxoval_tipos WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [i.tipoId, u.empresaId]);
        if (!t) throw new NotFoundException('Tipo de peça não encontrado.');
        const total = Number(t.total), rouparia = Number(t.rouparia), lavanderia = Number(t.lavanderia);
        const emUso = total - rouparia - lavanderia;
        const q = i.quantidade;
        let sql = '';
        let qtdMov = q;
        switch (dto.movimento) {
          case 'compra': sql = `total = total + ${q}, rouparia = rouparia + ${q}, lavagens = lavagens + ${q * lavIni}`; break;
          case 'envio':
            if (q > emUso + rouparia) throw new BadRequestException(`${t.nome}: só há ${emUso + rouparia} peças fora da lavanderia.`);
            // o sujo sai das suítes; se passar disso, sai da rouparia
            sql = q <= emUso ? `lavanderia = lavanderia + ${q}` : `lavanderia = lavanderia + ${q}, rouparia = rouparia - ${q - emUso}`;
            break;
          case 'retorno':
            if (q > lavanderia) throw new BadRequestException(`${t.nome}: só ${lavanderia} peças estão na lavanderia.`);
            sql = `lavanderia = lavanderia - ${q}, rouparia = rouparia + ${q}, lavagens = lavagens + ${q}`;
            break;
          case 'danificada':
          case 'extraviada': {
            const origem = dto.origem ?? 'suite';
            const disp = origem === 'rouparia' ? rouparia : origem === 'lavanderia' ? lavanderia : emUso;
            if (q > disp) throw new BadRequestException(`${t.nome}: só há ${disp} peças em ${origem === 'suite' ? 'uso nas suítes' : origem}.`);
            sql = `total = total - ${q}, perdas = perdas + ${q}${origem === 'rouparia' ? `, rouparia = rouparia - ${q}` : origem === 'lavanderia' ? `, lavanderia = lavanderia - ${q}` : ''}`;
            break;
          }
          case 'contagem': {
            // inventário: a rouparia passa a ter o que foi contado (diferença fica registrada)
            const max = total - lavanderia;
            if (q > max) throw new BadRequestException(`${t.nome}: a contagem passa do total cadastrado (${max} fora da lavanderia). Lance como compra.`);
            qtdMov = q - rouparia;
            sql = `rouparia = ${q}`;
            break;
          }
        }
        await m.query(`UPDATE enxoval_tipos SET ${sql} WHERE id = $1`, [t.id]);
        await m.query(
          `INSERT INTO enxoval_movimentos (empresa_id, tipo_id, movimento, quantidade, origem, unidade, responsavel, observacao, usuario_nome, lote_id, fotos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
          [u.empresaId, t.id, dto.movimento, qtdMov, dto.origem ?? null, dto.unidade?.trim() || null, dto.responsavel?.trim() || null,
            (usadas ? `Peças usadas (~${lavIni} lavagens cada${dto.mesesUso ? `, ${dto.mesesUso} meses de uso` : ''}). ` : '') + (dto.observacao?.trim() || '') || null,
            u.nome, loteId, fotos.length ? JSON.stringify(fotos) : null]);
      }
    });
    return { ...(await this.painel(u)), loteCriado };
  }

  /* ---------------- lotes (QR code) ---------------- */

  private async fmtLote(u: UsuarioToken, l: Record<string, unknown>) {
    const tipos = await this.ds.query(`SELECT id, total, lavagens, limite_lavagens, foto FROM enxoval_tipos WHERE empresa_id = $1`, [u.empresaId]);
    const mapa = new Map<string, Record<string, unknown>>(tipos.map((t: Record<string, unknown>) => [String(t.id), t]));
    const itens = (l.itens as ItemLote[]).map((i) => {
      const t = mapa.get(i.tipoId);
      const mediaAgora = t && Number(t.total) ? Number(t.lavagens) / Number(t.total) : i.mediaNaCompra;
      // estimativa: o que a peça já tinha + o quanto o enxoval desse tipo lavou desde a compra
      const est = Math.round(Number(l.lavagens_iniciais) + Math.max(0, mediaAgora - i.mediaNaCompra));
      const limite = Number(t?.limite_lavagens ?? 240);
      return { ...i, fotoUrl: urlFoto(u.empresaId, (t?.foto as string | null) ?? null), lavagensEstimadas: est, limiteLavagens: limite, vidaUsadaPct: Math.min(100, Math.round((est / limite) * 100)) };
    });
    return {
      id: l.id, numero: l.numero, codigo: l.codigo, token: l.token, itens, usadas: l.usadas, lavagensIniciais: Number(l.lavagens_iniciais), mesesUso: l.meses_uso,
      dataCompra: dia(l.data_compra), fornecedor: l.fornecedor, notaFiscal: l.nota_fiscal, observacao: l.observacao, criadoPor: l.criado_por, criadoEm: l.criado_em,
      pecas: itens.reduce((s, i) => s + i.quantidade, 0),
    };
  }

  async lotes(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT * FROM enxoval_lotes WHERE empresa_id = $1 ORDER BY numero DESC LIMIT 500`, [u.empresaId]);
    const perdas = await this.ds.query(
      `SELECT lote_id, SUM(quantidade)::int AS n FROM enxoval_movimentos WHERE empresa_id = $1 AND lote_id IS NOT NULL AND movimento IN ('danificada','extraviada') GROUP BY lote_id`, [u.empresaId]);
    const pm = new Map<string, number>(perdas.map((p: Record<string, unknown>) => [String(p.lote_id), Number(p.n)]));
    const out = [];
    for (const x of l) out.push({ ...(await this.fmtLote(u, x)), perdas: pm.get(String(x.id)) ?? 0 });
    return out;
  }

  /** abre pelo QR code (token) ou pelo código (L0001) */
  async lote(u: UsuarioToken, chave: string) {
    const [l] = await this.ds.query(`SELECT * FROM enxoval_lotes WHERE empresa_id = $1 AND (token = $2 OR upper(codigo) = upper($2) OR id::text = $2)`, [u.empresaId, chave]);
    if (!l) throw new NotFoundException('Lote não encontrado.');
    const movs = await this.ds.query(
      `SELECT m.id, m.movimento, m.quantidade, m.origem, m.unidade, m.responsavel, m.observacao, m.usuario_nome, m.criado_em, t.nome,
              COALESCE(jsonb_array_length(m.fotos), 0) AS nfotos
         FROM enxoval_movimentos m JOIN enxoval_tipos t ON t.id = m.tipo_id WHERE m.lote_id = $1 ORDER BY m.criado_em DESC`, [l.id]);
    return {
      ...(await this.fmtLote(u, l)),
      movimentos: movs.map((x: Record<string, unknown>) => ({ id: x.id, tipo: x.nome, movimento: x.movimento, quantidade: Number(x.quantidade), origem: x.origem, unidade: x.unidade,
        responsavel: x.responsavel, observacao: x.observacao, usuario: x.usuario_nome, criadoEm: x.criado_em, fotos: Number(x.nfotos) })),
    };
  }

  async fotosMovimento(u: UsuarioToken, id: string) {
    const [x] = await this.ds.query(`SELECT fotos FROM enxoval_movimentos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!x) throw new NotFoundException('Movimento não encontrado.');
    return { fotos: (x.fotos as string[] | null) ?? [] };
  }

  /* ---------------- responsável pelo enxoval ---------------- */

  async salvarPrecoKg(u: UsuarioToken, precoKg: number) {
    await this.ds.query(`INSERT INTO enxoval_config (empresa_id, preco_kg) VALUES ($1,$2) ON CONFLICT (empresa_id) DO UPDATE SET preco_kg = $2, atualizado_em = now()`,
      [u.empresaId, precoKg.toFixed(2)]);
    return { ok: true };
  }

  /**
   * Custo da lavanderia por locação no período: peças que voltaram lavadas × preço da lavagem (por peça, ou peso × preço do quilo),
   * mais o desgaste das peças (custo ÷ vida em lavagens), dividido pelos usos (contas fechadas) do período.
   */
  async custoLavanderia(u: UsuarioToken, de: string, ate: string) {
    const ini = new Date(`${de}T00:00:00-03:00`), fim = new Date(`${ate}T23:59:59.999-03:00`);
    const [cfg] = await this.ds.query(`SELECT preco_kg FROM enxoval_config WHERE empresa_id = $1`, [u.empresaId]);
    const precoKg = Number(cfg?.preco_kg ?? 0);
    const linhas: Record<string, unknown>[] = await this.ds.query(
      `SELECT t.id, t.nome, t.custo, t.custo_lavagem, t.peso_kg, t.limite_lavagens, COALESCE(sum(m.quantidade), 0)::int AS lavadas
         FROM enxoval_tipos t LEFT JOIN enxoval_movimentos m ON m.tipo_id = t.id AND m.movimento = 'retorno' AND m.criado_em BETWEEN $2 AND $3
        WHERE t.empresa_id = $1 AND t.ativo GROUP BY t.id ORDER BY t.nome`, [u.empresaId, ini, fim]);
    const [usos] = await this.ds.query(`SELECT count(*)::int AS n FROM estadias WHERE empresa_id = $1 AND status = 'fechada' AND saida_em BETWEEN $2 AND $3`, [u.empresaId, ini, fim]);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const tipos = linhas.map((t) => {
      const porPeca = Number(t.custo_lavagem) > 0 ? Number(t.custo_lavagem) : r2(Number(t.peso_kg) * precoKg);
      const lavadas = Number(t.lavadas);
      const desgaste = r2((lavadas * Number(t.custo)) / Math.max(1, Number(t.limite_lavagens)));
      return { id: t.id, nome: t.nome, lavadas, porPeca, semPreco: porPeca === 0, lavagem: r2(lavadas * porPeca), desgaste, total: r2(lavadas * porPeca + desgaste) };
    });
    const nUsos = Number(usos?.n ?? 0);
    const lavagem = r2(tipos.reduce((s, t) => s + t.lavagem, 0));
    const desgaste = r2(tipos.reduce((s, t) => s + t.desgaste, 0));
    return {
      de, ate, precoKg, usos: nUsos, tipos, lavagem, desgaste, total: r2(lavagem + desgaste),
      porLocacao: nUsos ? r2((lavagem + desgaste) / nUsos) : 0,
      lavagemPorLocacao: nUsos ? r2(lavagem / nUsos) : 0,
      pecasPorLocacao: nUsos ? Math.round((tipos.reduce((s, t) => s + t.lavadas, 0) / nUsos) * 10) / 10 : 0,
      semPreco: tipos.filter((t) => t.semPreco && t.lavadas > 0).map((t) => t.nome),
    };
  }

  async config(u: UsuarioToken) {
    const [c] = await this.ds.query(`SELECT * FROM enxoval_config WHERE empresa_id = $1`, [u.empresaId]);
    const usuarios = await this.ds.query(
      `SELECT x.id, x.nome, p.nome AS perfil FROM usuarios x JOIN perfis p ON p.id = x.perfil_id WHERE x.empresa_id = $1 AND x.ativo ORDER BY x.nome`, [u.empresaId]);
    return { responsavelId: c?.responsavel_usuario_id ?? null, responsavelNome: c?.responsavel_nome ?? null, precoKg: Number(c?.preco_kg ?? 0), usuarios: usuarios.map((x: Record<string, unknown>) => ({ id: x.id, nome: x.nome, perfil: x.perfil })) };
  }

  async definirResponsavel(u: UsuarioToken, usuarioId: string | null | undefined) {
    let nome: string | null = null;
    if (usuarioId) {
      const [x] = await this.ds.query(`SELECT nome FROM usuarios WHERE id = $1 AND empresa_id = $2 AND ativo`, [usuarioId, u.empresaId]);
      if (!x) throw new NotFoundException('Usuário não encontrado.');
      nome = x.nome;
    }
    await this.ds.query(
      `INSERT INTO enxoval_config (empresa_id, responsavel_usuario_id, responsavel_nome) VALUES ($1,$2,$3)
       ON CONFLICT (empresa_id) DO UPDATE SET responsavel_usuario_id = $2, responsavel_nome = $3, atualizado_em = now()`, [u.empresaId, usuarioId ?? null, nome]);
    return this.config(u);
  }

  /* ---------------- relatório assinado ---------------- */

  async relatorios(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT id, numero, de, ate, status, hash, hash_final, resp_nome, resp_assinado_em, ger_nome, ger_assinado_em, criado_por, criado_em
         FROM enxoval_relatorios WHERE empresa_id = $1 ORDER BY numero DESC LIMIT 300`, [u.empresaId]);
    return l.map((r: Record<string, unknown>) => ({
      id: r.id, numero: r.numero, de: dia(r.de), ate: dia(r.ate), status: r.status, hash: r.hash, hashFinal: r.hash_final, responsavel: r.resp_nome,
      responsavelEm: r.resp_assinado_em, gerente: r.ger_nome, gerenteEm: r.ger_assinado_em, criadoPor: r.criado_por, criadoEm: r.criado_em,
    }));
  }

  /** monta o retrato do período (o conteúdo é congelado e recebe um código de verificação SHA-256) */
  async criarRelatorio(u: UsuarioToken, dto: NovoRelatorioDto) {
    if (dto.ate < dto.de) throw new BadRequestException('A data final é antes da inicial.');
    const [emp] = await this.ds.query(`SELECT nome, cnpj FROM empresas WHERE id = $1`, [u.empresaId]);
    const painel = await this.painel(u);
    const movs = await this.ds.query(
      `SELECT m.*, t.nome, t.custo, l.codigo AS lote_codigo FROM enxoval_movimentos m JOIN enxoval_tipos t ON t.id = m.tipo_id LEFT JOIN enxoval_lotes l ON l.id = m.lote_id
        WHERE m.empresa_id = $1 AND (m.criado_em AT TIME ZONE '${FUSO}')::date BETWEEN $2::date AND $3::date ORDER BY m.criado_em`, [u.empresaId, dto.de, dto.ate]);
    const resumo = new Map<string, Record<string, number>>();
    for (const x of movs) {
      const r = resumo.get(x.nome) ?? { compra: 0, envio: 0, retorno: 0, danificada: 0, extraviada: 0, contagem: 0 };
      r[x.movimento] = (r[x.movimento] ?? 0) + Number(x.quantidade);
      resumo.set(x.nome, r);
    }
    const perdas = movs.filter((x: Record<string, unknown>) => x.movimento === 'danificada' || x.movimento === 'extraviada');
    const lotes = await this.ds.query(`SELECT codigo, data_compra, itens, usadas, lavagens_iniciais, fornecedor, nota_fiscal FROM enxoval_lotes WHERE empresa_id = $1 AND data_compra BETWEEN $2 AND $3 ORDER BY numero`,
      [u.empresaId, dto.de, dto.ate]);
    const [cfg] = await this.ds.query(`SELECT responsavel_nome FROM enxoval_config WHERE empresa_id = $1`, [u.empresaId]);
    const conteudo = {
      empresa: emp?.nome ?? '', cnpj: emp?.cnpj ?? null, periodo: { de: dto.de, ate: dto.ate }, geradoEm: new Date().toISOString(), geradoPor: u.nome,
      responsavelEnxoval: cfg?.responsavel_nome ?? null,
      saldos: painel.tipos.map((t: Record<string, unknown>) => ({ nome: t.nome, total: t.total, rouparia: t.rouparia, nasSuites: t.emUso, lavanderia: t.lavanderia, perdasAcumuladas: t.perdas,
        lavagensMedia: t.lavagensMedia, limiteLavagens: t.limiteLavagens, vidaUsadaPct: t.vidaUsadaPct, jogos: t.jogos })),
      movimentosNoPeriodo: [...resumo.entries()].map(([nome, r]) => ({ nome, ...r })),
      perdas: perdas.map((x: Record<string, unknown>) => {
        const fotos = (x.fotos as string[] | null) ?? [];
        return {
          movimentoId: x.id, em: x.criado_em, peca: x.nome, tipo: NOME_MOV[String(x.movimento)], quantidade: Number(x.quantidade), onde: x.origem, unidade: x.unidade,
          responsavel: x.responsavel, observacao: x.observacao, lancadoPor: x.usuario_nome, lote: x.lote_codigo, valor: Math.round(Number(x.quantidade) * Number(x.custo) * 100) / 100,
          fotos: fotos.map((f) => sha(f)),
        };
      }),
      valorPerdas: Math.round(perdas.reduce((s: number, x: Record<string, unknown>) => s + Number(x.quantidade) * Number(x.custo), 0) * 100) / 100,
      lotes: lotes.map((l: Record<string, unknown>) => ({ codigo: l.codigo, data: dia(l.data_compra), usadas: l.usadas, lavagensIniciais: l.lavagens_iniciais, fornecedor: l.fornecedor,
        notaFiscal: l.nota_fiscal, itens: (l.itens as ItemLote[]).map((i) => `${i.quantidade} ${i.nome}`) })),
      contagens: movs.filter((x: Record<string, unknown>) => x.movimento === 'contagem' && Number(x.quantidade) !== 0)
        .map((x: Record<string, unknown>) => ({ em: x.criado_em, peca: x.nome, diferenca: Number(x.quantidade), por: x.usuario_nome })),
      movimentoIds: movs.map((x: Record<string, unknown>) => x.id),
    };
    const texto = JSON.stringify(conteudo);
    const r = await this.ds.query('UPDATE empresas SET ultimo_relatorio_enxoval = ultimo_relatorio_enxoval + 1 WHERE id = $1 RETURNING ultimo_relatorio_enxoval', [u.empresaId]);
    const linha = Array.isArray(r?.[0]) ? r[0][0] : r?.[0];
    const [novo] = await this.ds.query(
      `INSERT INTO enxoval_relatorios (empresa_id, numero, de, ate, conteudo, hash, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [u.empresaId, Number(linha?.ultimo_relatorio_enxoval ?? 1), dto.de, dto.ate, texto, sha(texto), u.nome]);
    return { ok: true, id: novo.id };
  }

  async relatorio(u: UsuarioToken, id: string) {
    const [r] = await this.ds.query(`SELECT * FROM enxoval_relatorios WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r) throw new NotFoundException('Relatório não encontrado.');
    const conteudo = JSON.parse(r.conteudo);
    const conteudoIntegro = sha(r.conteudo) === r.hash;
    // fotos das perdas: confere uma a uma com o código guardado no relatório
    const ids: string[] = (conteudo.perdas ?? []).map((p: { movimentoId: string }) => p.movimentoId);
    const fotos: Record<string, { src: string; confere: boolean }[]> = {};
    if (ids.length) {
      const l = await this.ds.query(`SELECT id, fotos FROM enxoval_movimentos WHERE id = ANY($1::uuid[])`, [ids]);
      const mapa = new Map<string, string[]>(l.map((x: Record<string, unknown>) => [String(x.id), (x.fotos as string[] | null) ?? []]));
      for (const p of conteudo.perdas as { movimentoId: string; fotos: string[] }[]) {
        const atuais = mapa.get(p.movimentoId) ?? [];
        fotos[p.movimentoId] = atuais.map((f, i) => ({ src: f, confere: sha(f) === p.fotos[i] }));
      }
    }
    const finalOk = r.ger_assinado_em ? this.hashFinal(r) === r.hash_final : null;
    // mini foto de cada peça (pelo nome; fica fora do conteúdo assinado)
    const fotosTipos: Record<string, string> = {};
    for (const t of await this.ds.query(`SELECT nome, foto FROM enxoval_tipos WHERE empresa_id = $1 AND foto IS NOT NULL`, [u.empresaId])) fotosTipos[t.nome] = urlFoto(u.empresaId, t.foto)!;
    return {
      id: r.id, numero: r.numero, de: dia(r.de), ate: dia(r.ate), status: r.status, hash: r.hash, hashFinal: r.hash_final, conteudo, fotos, fotosTipos,
      integro: conteudoIntegro && finalOk !== false && Object.values(fotos).every((l) => l.every((f) => f.confere)),
      responsavel: r.resp_assinado_em ? { nome: r.resp_nome, assinatura: r.resp_assinatura, em: r.resp_assinado_em, ip: r.resp_ip } : null,
      gerente: r.ger_assinado_em ? { nome: r.ger_nome, assinatura: r.ger_assinatura, em: r.ger_assinado_em, ip: r.ger_ip } : null,
      criadoPor: r.criado_por, criadoEm: r.criado_em,
    };
  }

  private hashFinal(r: Record<string, unknown>) {
    const em = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
    return sha([r.hash, r.resp_nome, em(r.resp_assinado_em), sha(String(r.resp_assinatura)), r.ger_nome, em(r.ger_assinado_em), sha(String(r.ger_assinatura))].join('|'));
  }

  async excluirRascunho(u: UsuarioToken, id: string) {
    const [r] = await this.ds.query(`SELECT status FROM enxoval_relatorios WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r) throw new NotFoundException('Relatório não encontrado.');
    if (r.status !== 'rascunho') throw new BadRequestException('Relatório assinado não pode ser excluído.');
    await this.ds.query(`DELETE FROM enxoval_relatorios WHERE id = $1`, [id]);
    return { ok: true };
  }

  async assinar(u: UsuarioToken, id: string, dto: AssinarRelatorioDto, ip: string) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dto.assinatura)) throw new BadRequestException('Assinatura inválida. Assine no quadro.');
    // confirma que quem está logado é quem assina (a própria senha)
    const [eu] = await this.ds.query(`SELECT id, nome, senha_hash, ativo FROM usuarios WHERE id = $1 AND empresa_id = $2`, [u.sub, u.empresaId]);
    if (!eu || !eu.ativo || !(await bcrypt.compare(dto.senha, eu.senha_hash))) throw new ForbiddenException('Senha incorreta.');
    return this.ds.transaction(async (m) => {
      const [r] = await m.query(`SELECT * FROM enxoval_relatorios WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [id, u.empresaId]);
      if (!r) throw new NotFoundException('Relatório não encontrado.');
      if (sha(r.conteudo) !== r.hash) throw new BadRequestException('O conteúdo do relatório não confere com o código de verificação.');
      if (dto.papel === 'responsavel') {
        if (r.status !== 'rascunho') throw new BadRequestException('O responsável já assinou este relatório.');
        const [cfg] = await m.query(`SELECT responsavel_usuario_id FROM enxoval_config WHERE empresa_id = $1`, [u.empresaId]);
        if (cfg?.responsavel_usuario_id && cfg.responsavel_usuario_id !== u.sub) throw new ForbiddenException('Só o responsável pelo enxoval cadastrado pode assinar como responsável.');
        if (!cfg?.responsavel_usuario_id && !temPermissao(u, 'enxoval.gerenciar')) throw new ForbiddenException('Seu perfil não cuida do enxoval.');
        await m.query(`UPDATE enxoval_relatorios SET status = 'assinado_responsavel', resp_usuario_id = $2, resp_nome = $3, resp_assinatura = $4, resp_assinado_em = now(), resp_ip = $5 WHERE id = $1`,
          [id, u.sub, eu.nome, dto.assinatura, ip.slice(0, 60)]);
        // os movimentos do período (com as fotos) ficam travados junto
        const ids: string[] = JSON.parse(r.conteudo).movimentoIds ?? [];
        if (ids.length) await m.query(`UPDATE enxoval_movimentos SET relatorio_id = $2 WHERE id = ANY($1::uuid[]) AND relatorio_id IS NULL`, [ids, id]);
      } else {
        if (r.status === 'rascunho') throw new BadRequestException('O responsável pelo enxoval assina primeiro.');
        if (r.status === 'assinado') throw new BadRequestException('O gerente já assinou este relatório.');
        if (!temPermissao(u, 'enxoval.aprovar')) throw new ForbiddenException('Só quem tem a permissão de gerente do enxoval pode assinar como gerente.');
        if (r.resp_usuario_id === u.sub) throw new ForbiddenException('O gerente precisa ser outra pessoa (não quem assinou como responsável).');
        const [agora] = await m.query(`SELECT now() AS t`);
        const final = this.hashFinal({ ...r, ger_nome: eu.nome, ger_assinado_em: agora.t, ger_assinatura: dto.assinatura });
        await m.query(`UPDATE enxoval_relatorios SET status = 'assinado', ger_usuario_id = $2, ger_nome = $3, ger_assinatura = $4, ger_assinado_em = $5, ger_ip = $6, hash_final = $7 WHERE id = $1`,
          [id, u.sub, eu.nome, dto.assinatura, agora.t, ip.slice(0, 60), final]);
      }
      return { ok: true };
    });
  }

  async salvarKit(u: UsuarioToken, dto: KitDto) {
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM enxoval_kits WHERE empresa_id = $1 AND categoria_id = $2`, [u.empresaId, dto.categoriaId]);
      for (const i of dto.itens.filter((x) => x.quantidade > 0)) {
        await m.query(`INSERT INTO enxoval_kits (empresa_id, categoria_id, tipo_id, quantidade) VALUES ($1,$2,$3,$4)`, [u.empresaId, dto.categoriaId, i.tipoId, i.quantidade]);
      }
    });
    return this.painel(u);
  }

  async historico(u: UsuarioToken, dias = 30) {
    const l = await this.ds.query(
      `SELECT m.id, m.movimento, m.quantidade, m.origem, m.unidade, m.responsavel, m.observacao, m.usuario_nome, m.criado_em, t.nome,
              COALESCE(jsonb_array_length(m.fotos), 0) AS nfotos, l.codigo AS lote_codigo
         FROM enxoval_movimentos m JOIN enxoval_tipos t ON t.id = m.tipo_id LEFT JOIN enxoval_lotes l ON l.id = m.lote_id WHERE m.empresa_id = $1 AND m.criado_em >= now() - ($2 || ' days')::interval ORDER BY m.criado_em DESC LIMIT 1000`,
      [u.empresaId, String(dias)]);
    return l.map((x: Record<string, unknown>) => ({ id: x.id, tipo: x.nome, movimento: x.movimento, quantidade: Number(x.quantidade), origem: x.origem, unidade: x.unidade, responsavel: x.responsavel, observacao: x.observacao, usuario: x.usuario_nome, criadoEm: x.criado_em, fotos: Number(x.nfotos), lote: x.lote_codigo }));
  }
}
