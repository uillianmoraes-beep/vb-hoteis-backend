import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { baixarConsumo } from '../estoque/estoque.core';
import { FotosService } from './fotos.service';
import { AguaLocalDto, AguaRegistroDto } from './vistorias.dto';

const FUSO = 'America/Sao_Paulo';
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const fmtLocal = (l: Record<string, unknown>) => ({
  id: l.id, nome: l.nome, tipo: l.tipo, ambienteId: l.ambiente_id, ambiente: l.ambiente ?? null, unidadeId: l.unidade_id, unidade: l.unidade ?? null,
  phMin: n(l.ph_min), phMax: n(l.ph_max), cloroMin: n(l.cloro_min), cloroMax: n(l.cloro_max), ativo: l.ativo,
  ultimo: l.ultimo_em ? { em: l.ultimo_em, por: l.ultimo_por, ph: n(l.ultimo_ph), cloro: n(l.ultimo_cloro), foraDaFaixa: !!l.ultimo_fora } : null,
});

/** Piscinas, hidros, ofurôs: medições (pH, cloro…), o que foi feito e os produtos usados (baixa no estoque). */
@Injectable()
export class AguaService {
  constructor(private readonly ds: DataSource, private readonly fotos: FotosService) {}

  async locais(u: UsuarioToken, todos = false) {
    const l = await this.ds.query(
      `SELECT l.*, a.nome AS ambiente, un.codigo AS unidade, r.criado_em AS ultimo_em, r.usuario_nome AS ultimo_por, r.ph AS ultimo_ph, r.cloro AS ultimo_cloro, r.fora_da_faixa AS ultimo_fora
         FROM agua_locais l LEFT JOIN ambientes a ON a.id = l.ambiente_id LEFT JOIN unidades un ON un.id = l.unidade_id
         LEFT JOIN LATERAL (SELECT * FROM agua_registros x WHERE x.local_id = l.id ORDER BY x.criado_em DESC LIMIT 1) r ON true
        WHERE l.empresa_id = $1 ${todos ? '' : 'AND l.ativo'} ORDER BY l.tipo, l.nome`, [u.empresaId]);
    return l.map(fmtLocal);
  }

  private async conferirLocal(u: UsuarioToken, dto: AguaLocalDto) {
    if (dto.phMin > dto.phMax || dto.cloroMin > dto.cloroMax) throw new BadRequestException('O mínimo não pode ser maior que o máximo.');
    if (dto.ambienteId) {
      const [a] = await this.ds.query(`SELECT 1 FROM ambientes WHERE id = $1 AND empresa_id = $2`, [dto.ambienteId, u.empresaId]);
      if (!a) throw new BadRequestException('Ambiente inválido.');
    }
    if (dto.unidadeId) {
      const [un] = await this.ds.query(`SELECT ambiente_id FROM unidades WHERE id = $1 AND empresa_id = $2`, [dto.unidadeId, u.empresaId]);
      if (!un) throw new BadRequestException('Suíte/quarto inválido.');
      dto.ambienteId = un.ambiente_id;
    }
  }

  async criarLocal(u: UsuarioToken, dto: AguaLocalDto) {
    await this.conferirLocal(u, dto);
    await this.ds.query(
      `INSERT INTO agua_locais (empresa_id, ambiente_id, unidade_id, nome, tipo, ph_min, ph_max, cloro_min, cloro_max) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [u.empresaId, dto.ambienteId || null, dto.unidadeId || null, dto.nome.trim(), dto.tipo, dto.phMin, dto.phMax, dto.cloroMin, dto.cloroMax]);
    return this.locais(u, true);
  }

  async atualizarLocal(u: UsuarioToken, id: string, dto: AguaLocalDto) {
    await this.conferirLocal(u, dto);
    const r = await this.ds.query(
      `UPDATE agua_locais SET ambiente_id=$3, unidade_id=$4, nome=$5, tipo=$6, ph_min=$7, ph_max=$8, cloro_min=$9, cloro_max=$10, ativo=COALESCE($11, ativo)
        WHERE id = $1 AND empresa_id = $2 RETURNING id`,
      [id, u.empresaId, dto.ambienteId || null, dto.unidadeId || null, dto.nome.trim(), dto.tipo, dto.phMin, dto.phMax, dto.cloroMin, dto.cloroMax, dto.ativo ?? null]);
    if (!r.length) throw new NotFoundException('Local não encontrado.');
    return this.locais(u, true);
  }

  /** exclui do cadastro (o histórico fica) */
  async excluirLocal(u: UsuarioToken, id: string) {
    const r = await this.ds.query(`UPDATE agua_locais SET ativo = false WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId]);
    if (!r.length) throw new NotFoundException('Local não encontrado.');
    return this.locais(u, true);
  }

  async registrar(u: UsuarioToken, dto: AguaRegistroDto) {
    const [l] = await this.ds.query(`SELECT * FROM agua_locais WHERE id = $1 AND empresa_id = $2 AND ativo`, [dto.localId, u.empresaId]);
    if (!l) throw new NotFoundException('Piscina/hidro não encontrada.');
    if (dto.ph === undefined && dto.cloro === undefined && !dto.acoes.length && !dto.produtos.length) {
      throw new BadRequestException('Informe a medição, o que foi feito ou os produtos usados.');
    }
    const fora = (dto.ph !== undefined && (dto.ph < Number(l.ph_min) || dto.ph > Number(l.ph_max)))
      || (dto.cloro !== undefined && (dto.cloro < Number(l.cloro_min) || dto.cloro > Number(l.cloro_max)));
    const prods = dto.produtos.length
      ? await this.ds.query(`SELECT id, nome FROM produtos WHERE empresa_id = $1 AND id = ANY($2::uuid[])`, [u.empresaId, dto.produtos.map((p) => p.produtoId)])
      : [];
    const nome = new Map(prods.map((p: { id: string; nome: string }) => [p.id, p]));
    if (nome.size !== new Set(dto.produtos.map((p) => p.produtoId)).size) throw new BadRequestException('Produto não encontrado.');
    await this.fotos.conferir(u.empresaId, dto.fotoIds ?? []);
    const produtos = dto.produtos.map((p) => ({ produtoId: p.produtoId, nome: (nome.get(p.produtoId) as { nome: string }).nome, quantidade: p.quantidade }));
    const id = await this.ds.transaction(async (m) => {
      const [r] = await m.query(
        `INSERT INTO agua_registros (empresa_id, local_id, ph, cloro, alcalinidade, temperatura, acoes, produtos, fora_da_faixa, observacao, usuario_id, usuario_nome)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12) RETURNING id`,
        [u.empresaId, l.id, dto.ph ?? null, dto.cloro ?? null, dto.alcalinidade ?? null, dto.temperatura ?? null, JSON.stringify(dto.acoes.map((a) => a.trim()).filter(Boolean)),
          JSON.stringify(produtos), fora, dto.observacao?.trim() || null, u.sub, u.nome]);
      // produtos de tratamento saem do estoque do ambiente (se o produto controla estoque)
      for (const p of produtos) {
        await baixarConsumo(m, u.empresaId, l.ambiente_id, p.produtoId, p.quantidade, { referencia: `agua:${r.id}`, observacao: `Tratamento · ${l.nome}`, usuario: u.nome });
      }
      await this.fotos.vincular(m, u.empresaId, dto.fotoIds ?? [], r.id);
      return r.id as string;
    });
    return { ok: true, id, foraDaFaixa: fora };
  }

  async historico(u: UsuarioToken, f: { de?: string; ate?: string; localId?: string; usuario?: string }) {
    const ate = f.ate && DIA_RE.test(f.ate) ? f.ate : hojeSP();
    const de = f.de && DIA_RE.test(f.de) ? f.de : new Date(Date.parse(`${ate}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
    const p: unknown[] = [u.empresaId, new Date(`${de}T00:00:00-03:00`), new Date(`${ate}T23:59:59.999-03:00`)];
    let w = '';
    if (f.localId && /^[0-9a-f-]{36}$/i.test(f.localId)) { p.push(f.localId); w += ` AND r.local_id = $${p.length}`; }
    if (f.usuario?.trim()) { p.push(`%${f.usuario.trim().toLowerCase()}%`); w += ` AND lower(r.usuario_nome) LIKE $${p.length}`; }
    const l = await this.ds.query(
      `SELECT r.*, l.nome AS local, l.tipo, (SELECT json_agg(ft.id) FROM fotos ft WHERE ft.referencia_id = r.id) AS fotos
         FROM agua_registros r JOIN agua_locais l ON l.id = r.local_id
        WHERE r.empresa_id = $1 AND r.criado_em BETWEEN $2 AND $3${w} ORDER BY r.criado_em DESC LIMIT 2000`, p);
    const lista = l.map((r: Record<string, unknown>) => ({
      id: r.id, criadoEm: r.criado_em, localId: r.local_id, local: r.local, tipo: r.tipo, ph: n(r.ph), cloro: n(r.cloro), alcalinidade: n(r.alcalinidade),
      temperatura: n(r.temperatura), acoes: r.acoes, produtos: r.produtos, foraDaFaixa: r.fora_da_faixa, observacao: r.observacao, usuario: r.usuario_nome,
      fotos: (r.fotos as string[] | null) ?? [],
    }));
    // resumo por usuário (quem fez quantos registros e quantos fora da faixa)
    const pu = new Map<string, { nome: string; registros: number; foraDaFaixa: number }>();
    for (const r of lista) {
      const k = (r.usuario as string) || '—';
      const x = pu.get(k) ?? { nome: k, registros: 0, foraDaFaixa: 0 };
      x.registros++;
      if (r.foraDaFaixa) x.foraDaFaixa++;
      pu.set(k, x);
    }
    return { periodo: { de, ate }, lista, porUsuario: [...pu.values()].sort((a, b) => b.registros - a.registros) };
  }
}
