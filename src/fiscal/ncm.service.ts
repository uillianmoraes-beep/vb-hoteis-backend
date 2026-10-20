import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const URL_NCM = 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO';
const sem = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const limpa = (t: string) => t.replace(/^[-\s]+/, '').replace(/[:.]$/, '').trim();
/** palavras que não ajudam a achar o NCM */
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'e', 'em', 'para', 'por', 'a', 'o', 'ml', 'l', 'g', 'kg', 'un', 'cx', 'lata', 'garrafa', 'pct', 'pacote']);

export interface SugestaoNcm {
  ncm: string; descricao: string; completa: string | null; motivo: string | null; cest: string | null;
  substituicaoTributaria: boolean; fonte: 'ia' | 'tabela';
  /** a melhor opção (a primeira da IA, ou a única/mais forte da tabela) */
  recomendada?: boolean;
  /** PIS/COFINS monofásico (bebidas frias, combustíveis, farmácia…): na revenda a alíquota é zero */
  monofasico?: boolean;
}

/** O que a IA devolve (formato fixo, validado). */
const RespostaIa = z.object({
  sugestoes: z.array(z.object({
    ncm: z.string().describe('8 dígitos, só números'),
    motivo: z.string().describe('uma frase curta em português explicando a escolha'),
    cest: z.string().describe('7 dígitos se o item tiver CEST (substituição tributária), senão vazio'),
    substituicao_tributaria: z.boolean().describe('true se o item costuma ter ICMS por substituição tributária'),
    monofasico: z.boolean().describe('true se PIS/COFINS são monofásicos para este NCM (ex.: refrigerantes, cervejas, águas, cosméticos, medicamentos)'),
  })),
});

/**
 * Busca de tributação pelo nome do produto: tabela oficial de NCM (Siscomex, baixada na primeira busca)
 * + sugestão por IA (Claude) quando o servidor tem ANTHROPIC_API_KEY. A IA escolhe entre os NCM oficiais.
 */
@Injectable()
export class NcmService {
  private readonly log = new Logger('NCM');
  private carregando: Promise<void> | null = null;
  private readonly ia = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  constructor(private readonly ds: DataSource) {}

  /** baixa a tabela oficial se ainda não tiver (uma vez; as outras buscas esperam a mesma carga) */
  private async garantirTabela() {
    const [{ n }] = await this.ds.query(`SELECT COUNT(*)::int AS n FROM ncm`);
    if (n > 0) return;
    this.carregando ??= this.baixar().finally(() => { this.carregando = null; });
    await this.carregando;
  }

  private async baixar() {
    const r = await fetch(URL_NCM, { redirect: 'follow' });
    if (!r.ok) throw new ServiceUnavailableException('Não consegui baixar a tabela de NCM do governo agora. Tente de novo em instantes.');
    const j = (await r.json()) as { Data_Ultima_Atualizacao_NCM?: string; Nomenclaturas: { Codigo: string; Descricao: string }[] };
    const porCodigo = new Map(j.Nomenclaturas.map((x) => [x.Codigo, limpa(x.Descricao)]));
    const itens = j.Nomenclaturas.filter((x) => /^\d{4}\.\d{2}\.\d{2}$/.test(x.Codigo)).map((x) => {
      const d = x.Codigo.replace(/\D/g, '');
      // caminho: capítulo › posição › subposições › item
      const chaves = [d.slice(0, 2), `${d.slice(0, 2)}.${d.slice(2, 4)}`, `${d.slice(0, 4)}.${d[4]}`, `${d.slice(0, 4)}.${d.slice(4, 6)}`, `${d.slice(0, 4)}.${d.slice(4, 6)}.${d[6]}`];
      const caminho = [...new Set(chaves.map((k) => porCodigo.get(k)).filter((t): t is string => !!t && !/^outr[oa]s$/i.test(t)))];
      const desc = limpa(x.Descricao);
      const completa = [...caminho, desc].join(' › ');
      return { codigo: d, descricao: desc, completa, busca: sem(completa) };
    });
    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM ncm`);
      for (let i = 0; i < itens.length; i += 500) {
        const lote = itens.slice(i, i + 500);
        const vals: unknown[] = [];
        const ph = lote.map((x, k) => { vals.push(x.codigo, x.descricao, x.completa, x.busca); return `($${k * 4 + 1},$${k * 4 + 2},$${k * 4 + 3},$${k * 4 + 4})`; });
        await m.query(`INSERT INTO ncm (codigo, descricao, completa, busca) VALUES ${ph.join(',')} ON CONFLICT (codigo) DO NOTHING`, vals);
      }
      await m.query(`INSERT INTO ncm_versao (id, vigencia, baixado_em) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET vigencia = $1, baixado_em = now()`,
        [j.Data_Ultima_Atualizacao_NCM ?? null]);
    });
    this.log.log(`Tabela NCM carregada: ${itens.length} itens.`);
  }

  /** busca na tabela: todas as palavras (ou a maioria) presentes, os itens mais específicos primeiro */
  private async naTabela(termo: string, limite = 15) {
    const palavras = [...new Set(sem(termo).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !VAZIAS.has(p) && !/^\d+$/.test(p)))].slice(0, 6);
    if (!palavras.length) return [];
    // raiz da palavra (cerveja/cervejas, refrigerante/refrigerantes)
    const raizes = palavras.map((p) => (p.length > 5 ? p.slice(0, p.length - 2) : p));
    // só no começo de uma palavra: "cola" não casa com "hortícolas"
    const casos = raizes.map((_, i) => `(CASE WHEN busca ~ $${i + 1} THEN 1 ELSE 0 END)`).join(' + ');
    const l: { codigo: string; descricao: string; completa: string; pontos: number }[] = await this.ds.query(
      `SELECT codigo, descricao, completa, ${casos} AS pontos FROM ncm WHERE ${raizes.map((_, i) => `busca ~ $${i + 1}`).join(' OR ')}
        ORDER BY pontos DESC, length(completa) LIMIT ${limite}`, raizes.map((r) => `\\m${r.replace(/[^a-z0-9]/g, '')}`));
    // a maioria das palavras; se nenhum item tiver, os que têm alguma (marca no nome: "Cerveja Heineken")
    const minimo = Math.max(1, Math.ceil(raizes.length / 2));
    const fortes = l.filter((x) => Number(x.pontos) >= minimo);
    return fortes.length ? fortes : l;
  }

  /** regime tributário guardado da empresa */
  async regime(empresaId: string): Promise<string | null> {
    const [e] = await this.ds.query(`SELECT regime_tributario FROM empresas WHERE id = $1`, [empresaId]);
    return e?.regime_tributario ?? null;
  }

  async salvarRegime(empresaId: string, regime: 'simples' | 'mei' | 'normal') {
    await this.ds.query(`UPDATE empresas SET regime_tributario = $2 WHERE id = $1`, [empresaId, regime]);
    return { ok: true, regime };
  }

  async buscar(termo: string): Promise<{ sugestoes: SugestaoNcm[]; ia: boolean; vigencia: string | null }> {
    const t = termo.trim().slice(0, 200);
    if (t.length < 2) return { sugestoes: [], ia: !!this.ia, vigencia: null };
    await this.garantirTabela();
    const [v] = await this.ds.query(`SELECT vigencia FROM ncm_versao WHERE id = 1`);
    // código digitado direto
    const soDigitos = t.replace(/\D/g, '');
    if (soDigitos.length === 8) {
      const [x] = await this.ds.query(`SELECT codigo, descricao, completa FROM ncm WHERE codigo = $1`, [soDigitos]);
      if (x) return { sugestoes: [{ ncm: x.codigo, descricao: x.descricao, completa: x.completa, motivo: null, cest: null, substituicaoTributaria: false, fonte: 'tabela' }], ia: !!this.ia, vigencia: v?.vigencia ?? null };
    }
    const candidatos = await this.naTabela(t);
    const nPalavras = new Set(sem(t).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !VAZIAS.has(p) && !/^\d+$/.test(p))).size;
    const daTabela: SugestaoNcm[] = candidatos.slice(0, 6).map((x) => ({
      ncm: x.codigo, descricao: x.descricao, completa: x.completa, motivo: null, cest: null, substituicaoTributaria: false, fonte: 'tabela',
    }));
    const daIa = this.ia ? await this.sugerirIa(t, candidatos).catch((e) => { this.log.warn(`IA indisponível: ${e instanceof Error ? e.message : e}`); return []; }) : [];
    // IA primeiro; depois o que a tabela achou e a IA não repetiu
    const vistos = new Set(daIa.map((s) => s.ncm));
    // com a IA respondendo, da tabela só entra o que tem todas as palavras (o resto vira ruído)
    const tabelaFiltrada = daIa.length
      ? daTabela.filter((s, i) => !vistos.has(s.ncm) && Number(candidatos[i]?.pontos ?? 0) >= Math.min(nPalavras, 2))
      : daTabela;
    const lista = [...daIa, ...tabelaFiltrada].slice(0, 8);
    // a melhor opção: a primeira da IA; sem IA, a primeira da tabela se casou todas as palavras
    if (lista[0] && (lista[0].fonte === 'ia' || Number(candidatos[0]?.pontos ?? 0) >= nPalavras)) lista[0] = { ...lista[0], recomendada: true };
    return { sugestoes: lista, ia: !!this.ia, vigencia: v?.vigencia ?? null };
  }

  /** pede ao Claude até 3 NCM para o produto, com o motivo; confere cada código na tabela oficial */
  private async sugerirIa(produto: string, candidatos: { codigo: string; completa: string }[]): Promise<SugestaoNcm[]> {
    const lista = candidatos.map((c) => `${c.codigo} — ${c.completa}`).join('\n');
    // fallbacks: se o modelo recusar, a própria API tenta outro modelo na mesma chamada
    const resposta = await this.ia!.beta.messages.parse({
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      output_config: { effort: 'low', format: zodOutputFormat(RespostaIa) },
      system: 'Você é assistente fiscal brasileiro de hotéis, motéis e restaurantes. Dado o nome de um produto vendido ou usado, '
        + 'sugira até 3 classificações NCM (8 dígitos) da tabela vigente, da mais provável para a menos provável, com um motivo curto. '
        + 'Informe o CEST quando o item estiver no Convênio ICMS 142/2018 (ex.: bebidas, cervejas, refrigerantes, águas) e se costuma ter substituição tributária. '
        + 'Se a lista de candidatos da tabela oficial tiver o código certo, prefira-o. Responda em português.',
      messages: [{
        role: 'user',
        content: `Produto: ${produto}\n\nCandidatos achados na tabela oficial pelo nome (podem não incluir o certo):\n${lista || '(nenhum)'}`,
      }],
    });
    if (resposta.stop_reason === 'refusal' || !resposta.parsed_output) return [];
    const codigos = resposta.parsed_output.sugestoes.map((s) => s.ncm.replace(/\D/g, '')).filter((c) => c.length === 8);
    if (!codigos.length) return [];
    const oficiais: { codigo: string; descricao: string; completa: string }[] =
      await this.ds.query(`SELECT codigo, descricao, completa FROM ncm WHERE codigo = ANY($1::varchar[])`, [codigos]);
    const mapa = new Map(oficiais.map((o) => [o.codigo, o]));
    return resposta.parsed_output.sugestoes.flatMap((s) => {
      const c = s.ncm.replace(/\D/g, '');
      const o = mapa.get(c);
      if (!o) return []; // código que não existe na tabela vigente: descarta
      const cest = s.cest.replace(/\D/g, '');
      return [{ ncm: c, descricao: o.descricao, completa: o.completa, motivo: s.motivo, cest: cest.length === 7 ? cest : null, substituicaoTributaria: s.substituicao_tributaria, monofasico: s.monofasico, fonte: 'ia' as const }];
    }).slice(0, 3);
  }
}
