import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Post, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Cancelamentos e estornos por usuário: itens cancelados nas contas, entradas canceladas,
 * mercadoria que voltou ao estoque (o estoquista confere), ajustes e perdas do estoque e entradas de nota.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const ini = (d: string) => new Date(`${d}T03:00:00Z`);
const r2 = (v: number) => Math.round(v * 100) / 100;

class ConferirDto {
  /** vazio = todas as pendentes */
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) ids?: string[];
}

@Injectable()
export class EstornosService {
  constructor(private readonly ds: DataSource) {}

  async ver(u: UsuarioToken, de: string, ate: string) {
    const p = [u.empresaId, ini(de), ini(somaDias(ate, 1))];
    const amb = u.ambientesIds?.length ? u.ambientesIds : null;
    const filtroAmb = (col: string) => (amb ? ` AND ${col} = ANY($4::uuid[])` : '');
    const pa = amb ? [...p, amb] : p;

    const itens = (await this.ds.query(
      `SELECT i.id, i.descricao, i.quantidade, i.total, i.motivo_estorno, i.usuario_nome, i.estornado_por, i.estornado_em, i.criado_em,
              e.numero, un.codigo, a.nome AS ambiente,
              EXISTS (SELECT 1 FROM estoque_movimentos m WHERE m.referencia = 'item:' || i.id::text AND m.tipo = 'estorno') AS voltou
         FROM estadia_itens i JOIN estadias e ON e.id = i.estadia_id LEFT JOIN unidades un ON un.id = e.unidade_id LEFT JOIN ambientes a ON a.id = e.ambiente_id
        WHERE i.empresa_id = $1 AND i.status = 'estornado' AND i.estornado_em >= $2 AND i.estornado_em < $3${filtroAmb('e.ambiente_id')}
        ORDER BY i.estornado_em DESC LIMIT 2000`, pa)).map((x: Record<string, unknown>) => ({
      id: x.id, quando: x.estornado_em, lancadoEm: x.criado_em, item: x.descricao, quantidade: Number(x.quantidade), valor: Number(x.total), motivo: x.motivo_estorno,
      lancadoPor: x.usuario_nome, estornadoPor: x.estornado_por, uso: x.numero, unidade: x.codigo, ambiente: x.ambiente, voltouAoEstoque: !!x.voltou,
    }));
    const contas = (await this.ds.query(
      `SELECT e.id, e.numero, e.entrada_em, e.saida_em, e.motivo_ajuste, e.usuario_entrada_nome, e.usuario_saida_nome, un.codigo, a.nome AS ambiente,
              (SELECT COALESCE(sum(total),0) FROM estadia_itens i WHERE i.estadia_id = e.id) AS consumo
         FROM estadias e LEFT JOIN unidades un ON un.id = e.unidade_id LEFT JOIN ambientes a ON a.id = e.ambiente_id
        WHERE e.empresa_id = $1 AND e.status = 'cancelada' AND e.saida_em >= $2 AND e.saida_em < $3${filtroAmb('e.ambiente_id')}
        ORDER BY e.saida_em DESC LIMIT 1000`, pa)).map((x: Record<string, unknown>) => ({
      id: x.id, uso: x.numero, unidade: x.codigo, ambiente: x.ambiente, entrada: x.entrada_em, quando: x.saida_em, motivo: x.motivo_ajuste,
      entradaPor: x.usuario_entrada_nome, canceladaPor: x.usuario_saida_nome, consumo: Number(x.consumo),
    }));
    const movs = (await this.ds.query(
      `SELECT m.id, m.tipo, m.quantidade, m.custo_unitario, m.documento, m.referencia, m.observacao, m.usuario_nome, m.criado_em, m.conferido_em, m.conferido_por,
              pr.nome AS produto, pr.unidade, l.nome AS local
         FROM estoque_movimentos m JOIN produtos pr ON pr.id = m.produto_id LEFT JOIN estoque_locais l ON l.id = m.local_id
        WHERE m.empresa_id = $1 AND m.criado_em >= $2 AND m.criado_em < $3 AND (m.tipo IN ('estorno','ajuste','perda') OR (m.tipo = 'entrada' AND m.documento IS NOT NULL))
        ORDER BY m.criado_em DESC LIMIT 3000`, p)).map((x: Record<string, unknown>) => ({
      id: x.id, tipo: x.tipo, quantidade: Number(x.quantidade), valor: r2(Math.abs(Number(x.quantidade)) * Number(x.custo_unitario)), documento: x.documento,
      referencia: x.referencia, observacao: x.observacao, usuario: x.usuario_nome, quando: x.criado_em, conferidoEm: x.conferido_em, conferidoPor: x.conferido_por,
      produto: x.produto, unidade: x.unidade, local: x.local,
    }));
    // devoluções ainda não conferidas (qualquer data): é o que o estoquista tem para olhar
    const [pend] = await this.ds.query(`SELECT count(*)::int AS n FROM estoque_movimentos WHERE empresa_id = $1 AND tipo = 'estorno' AND conferido_em IS NULL`, [u.empresaId]);

    // resumo por usuário
    const porUsuario = new Map<string, { usuario: string; itens: number; valorItens: number; contas: number; ajustes: number; valorAjustes: number; perdas: number; valorPerdas: number; entradas: number }>();
    const de_ = (nome: string | null | undefined) => {
      const k = nome || '—';
      return porUsuario.get(k) ?? porUsuario.set(k, { usuario: k, itens: 0, valorItens: 0, contas: 0, ajustes: 0, valorAjustes: 0, perdas: 0, valorPerdas: 0, entradas: 0 }).get(k)!;
    };
    for (const i of itens) { const x = de_(i.estornadoPor as string); x.itens++; x.valorItens = r2(x.valorItens + i.valor); }
    for (const c of contas) de_(c.canceladaPor as string).contas++;
    for (const m of movs) {
      if (m.tipo === 'ajuste') { const x = de_(m.usuario as string); x.ajustes++; x.valorAjustes = r2(x.valorAjustes + m.valor * Math.sign(m.quantidade)); }
      if (m.tipo === 'perda') { const x = de_(m.usuario as string); x.perdas++; x.valorPerdas = r2(x.valorPerdas + m.valor); }
      if (m.tipo === 'entrada') de_(m.usuario as string).entradas++;
    }
    return {
      de, ate, pendentes: pend?.n ?? 0,
      porUsuario: [...porUsuario.values()].sort((a, b) => b.valorItens + b.contas - (a.valorItens + a.contas)),
      itens, contas,
      devolucoes: movs.filter((m: { tipo: string }) => m.tipo === 'estorno'),
      ajustes: movs.filter((m: { tipo: string }) => m.tipo === 'ajuste' || m.tipo === 'perda'),
      entradas: movs.filter((m: { tipo: string }) => m.tipo === 'entrada'),
    };
  }

  /** devoluções que o estoquista ainda não conferiu (para a tela, sem limite de data) */
  async pendentes(u: UsuarioToken) {
    return (await this.ds.query(
      `SELECT m.id, m.quantidade, m.custo_unitario, m.referencia, m.observacao, m.usuario_nome, m.criado_em, pr.nome AS produto, pr.unidade, l.nome AS local
         FROM estoque_movimentos m JOIN produtos pr ON pr.id = m.produto_id LEFT JOIN estoque_locais l ON l.id = m.local_id
        WHERE m.empresa_id = $1 AND m.tipo = 'estorno' AND m.conferido_em IS NULL ORDER BY m.criado_em LIMIT 500`, [u.empresaId])).map((x: Record<string, unknown>) => ({
      id: x.id, quantidade: Number(x.quantidade), valor: r2(Math.abs(Number(x.quantidade)) * Number(x.custo_unitario)), referencia: x.referencia, observacao: x.observacao,
      usuario: x.usuario_nome, quando: x.criado_em, produto: x.produto, unidade: x.unidade, local: x.local,
    }));
  }

  async conferir(u: UsuarioToken, dto: ConferirDto) {
    const r = dto.ids?.length
      ? await this.ds.query(`UPDATE estoque_movimentos SET conferido_em = now(), conferido_por = $2 WHERE empresa_id = $1 AND tipo = 'estorno' AND conferido_em IS NULL AND id = ANY($3::uuid[]) RETURNING id`,
        [u.empresaId, u.nome, dto.ids])
      : await this.ds.query(`UPDATE estoque_movimentos SET conferido_em = now(), conferido_por = $2 WHERE empresa_id = $1 AND tipo = 'estorno' AND conferido_em IS NULL RETURNING id`,
        [u.empresaId, u.nome]);
    const n = Array.isArray(r?.[0]) ? r[0].length : r?.length ?? 0;
    return { ok: true, conferidos: n };
  }
}

@Controller('relatorios/estornos')
export class EstornosController {
  constructor(private readonly service: EstornosService) {}

  @Get()
  @Requer('relatorios.ver', 'estoque.gerenciar', 'caixa.relatorios')
  ver(@Usuario() u: UsuarioToken, @Query('de') de?: string, @Query('ate') ate?: string) {
    const a = ate && DATA.test(ate) ? ate : hojeSP();
    const d = de && DATA.test(de) ? de : somaDias(a, -29);
    if (d > a) throw new BadRequestException('A data inicial é depois da final.');
    return this.service.ver(u, d, a);
  }

  @Get('pendentes')
  @Requer('estoque.gerenciar', 'relatorios.ver')
  pendentes(@Usuario() u: UsuarioToken) {
    return this.service.pendentes(u);
  }

  @Post('conferir')
  @HttpCode(200)
  @Requer('estoque.gerenciar')
  conferir(@Usuario() u: UsuarioToken, @Body() dto: ConferirDto) {
    return this.service.conferir(u, dto);
  }
}
