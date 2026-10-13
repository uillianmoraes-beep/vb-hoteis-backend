import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KitDto, MovimentoEnxovalDto, TipoEnxovalDto } from './enxoval.dto';
import { UsuarioToken } from '../common/permissoes';

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
          id: t.id, nome: t.nome, total, rouparia: Number(t.rouparia), lavanderia: Number(t.lavanderia), emUso, perdas: Number(t.perdas),
          lavagensMedia: Math.round(media), limiteLavagens: Number(t.limite_lavagens), vidaUsadaPct: Math.min(100, Math.round((media / Number(t.limite_lavagens)) * 100)),
          custo: Number(t.custo), porRodada: rodada, jogos: rodada ? Math.round((total / rodada) * 10) / 10 : null,
        };
      }),
      kits: kits.map((k: Record<string, unknown>) => ({ categoriaId: k.categoria_id, tipoId: k.tipo_id, quantidade: Number(k.quantidade) })),
    };
  }

  async criarTipo(u: UsuarioToken, dto: TipoEnxovalDto) {
    await this.ds.query(`INSERT INTO enxoval_tipos (empresa_id, nome, limite_lavagens, custo) VALUES ($1,$2,$3,$4)`,
      [u.empresaId, dto.nome.trim(), dto.limiteLavagens ?? 240, (dto.custo ?? 0).toFixed(2)]);
    return this.painel(u);
  }

  async editarTipo(u: UsuarioToken, id: string, dto: TipoEnxovalDto) {
    await this.ds.query(`UPDATE enxoval_tipos SET nome = $3, limite_lavagens = $4, custo = $5 WHERE id = $1 AND empresa_id = $2`,
      [id, u.empresaId, dto.nome.trim(), dto.limiteLavagens ?? 240, (dto.custo ?? 0).toFixed(2)]);
    return this.painel(u);
  }

  async movimentar(u: UsuarioToken, dto: MovimentoEnxovalDto) {
    const itens = dto.itens.filter((i) => i.quantidade > 0);
    if (!itens.length) throw new BadRequestException('Informe as quantidades.');
    await this.ds.transaction(async (m) => {
      for (const i of itens) {
        const [t] = await m.query(`SELECT * FROM enxoval_tipos WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [i.tipoId, u.empresaId]);
        if (!t) throw new NotFoundException('Tipo de peça não encontrado.');
        const total = Number(t.total), rouparia = Number(t.rouparia), lavanderia = Number(t.lavanderia);
        const emUso = total - rouparia - lavanderia;
        const q = i.quantidade;
        let sql = '';
        let qtdMov = q;
        switch (dto.movimento) {
          case 'compra': sql = `total = total + ${q}, rouparia = rouparia + ${q}`; break;
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
          `INSERT INTO enxoval_movimentos (empresa_id, tipo_id, movimento, quantidade, origem, unidade, responsavel, observacao, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [u.empresaId, t.id, dto.movimento, qtdMov, dto.origem ?? null, dto.unidade?.trim() || null, dto.responsavel?.trim() || null, dto.observacao?.trim() || null, u.nome]);
      }
    });
    return this.painel(u);
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
      `SELECT m.*, t.nome FROM enxoval_movimentos m JOIN enxoval_tipos t ON t.id = m.tipo_id WHERE m.empresa_id = $1 AND m.criado_em >= now() - ($2 || ' days')::interval ORDER BY m.criado_em DESC LIMIT 1000`,
      [u.empresaId, String(dias)]);
    return l.map((x: Record<string, unknown>) => ({ id: x.id, tipo: x.nome, movimento: x.movimento, quantidade: Number(x.quantidade), origem: x.origem, unidade: x.unidade, responsavel: x.responsavel, observacao: x.observacao, usuario: x.usuario_nome, criadoEm: x.criado_em }));
  }
}
