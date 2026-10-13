import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { NovaSugestaoDto, ResponderSugestaoDto } from './sugestoes.dto';
import { UsuarioToken } from '../common/permissoes';

const fmt = (s: Record<string, unknown>) => ({
  id: s.id, empresaId: s.empresa_id, empresa: s.empresa ?? null, usuario: s.usuario_nome, tipo: s.tipo, area: s.area, tela: s.tela, texto: s.texto,
  status: s.status, resposta: s.resposta, respondidoEm: s.respondido_em, criadoEm: s.criado_em,
});

@Injectable()
export class SugestoesService {
  constructor(private readonly ds: DataSource) {}

  async criar(u: UsuarioToken, dto: NovaSugestaoDto) {
    const [n] = await this.ds.query(`SELECT count(*)::int AS n FROM sugestoes WHERE empresa_id = $1 AND criado_em > now() - interval '1 day'`, [u.empresaId]);
    if (Number(n.n) >= 30) throw new BadRequestException('Muitos envios hoje. Tente amanhã.');
    await this.ds.query(`INSERT INTO sugestoes (empresa_id, usuario_id, usuario_nome, tipo, area, tela, texto) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [u.empresaId, u.sub, u.nome, dto.tipo, dto.area?.trim() || null, dto.tela?.trim() || null, dto.texto.trim()]);
    return { ok: true };
  }

  async minhas(u: UsuarioToken) {
    const l = await this.ds.query(`SELECT * FROM sugestoes WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 100`, [u.empresaId]);
    return l.map(fmt);
  }

  /* ---- Virtual Barra (chave mestra) ---- */

  async todas(status?: string) {
    const params: unknown[] = [];
    let where = '';
    if (status === 'abertas') where = `WHERE s.status IN ('nova','avaliando','vou_fazer')`;
    else if (status && /^[a-z_]{3,12}$/.test(status) && status !== 'todas') { params.push(status); where = `WHERE s.status = $1`; }
    const l = await this.ds.query(`SELECT s.*, e.nome AS empresa FROM sugestoes s JOIN empresas e ON e.id = s.empresa_id ${where} ORDER BY s.criado_em DESC LIMIT 1000`, params);
    const porArea = await this.ds.query(
      `SELECT COALESCE(area, 'Geral') AS area, count(*)::int AS pedidos, count(DISTINCT empresa_id)::int AS empresas,
              count(*) FILTER (WHERE status = 'nova')::int AS novas
         FROM sugestoes WHERE tipo = 'melhoria' AND status NOT IN ('ja_existe','nao_vale') GROUP BY 1 ORDER BY 2 DESC`);
    const [tot] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE status = 'nova')::int AS novas, count(*) FILTER (WHERE tipo = 'problema' AND status IN ('nova','avaliando'))::int AS problemas,
              count(*)::int AS total, count(DISTINCT empresa_id)::int AS empresas FROM sugestoes`);
    return { totais: tot, porArea, lista: l.map(fmt) };
  }

  async responder(id: string, dto: ResponderSugestaoDto) {
    const [s] = await this.ds.query(`SELECT id FROM sugestoes WHERE id = $1`, [id]);
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    await this.ds.query(`UPDATE sugestoes SET status = $2, resposta = $3, respondido_em = now() WHERE id = $1`, [id, dto.status, dto.resposta?.trim() || null]);
    return { ok: true };
  }
}
