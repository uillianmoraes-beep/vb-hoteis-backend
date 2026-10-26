import { BadRequestException, Body, Controller, HttpCode, Injectable, Logger, Module, Post, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { Usuario } from '../common/decorators/usuario.decorator';
import { UsuarioToken, temPermissao } from '../common/permissoes';

/**
 * "Pergunte ao VB": assistente com IA (Claude) que responde sobre o hotel/motel com os dados do sistema
 * (ocupação, quem chega, vendas, contas, estoque, equipe, pedidos) e indica a tela certa para resolver.
 * Só consulta: não muda nada no sistema. Cada consulta respeita as permissões de quem pergunta.
 */

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const n = (v: unknown) => Number(v ?? 0);
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

/** telas que a IA pode indicar (ela devolve o link e a pessoa clica) */
const TELAS = `/painel Quartos (recepção) · /reservas Reservas · /hospedes Hóspedes · /caixa Caixa · /servico-quartos Serviço de quartos · /cozinha Cozinha e bar ·
/faturamento Faturamento · /despesas Contas a pagar · /conciliacao Conciliação bancária · /financeiro DRE e fluxo de caixa · /financeiro?aba=recebiveis Recebíveis ·
/produtos Produtos e estoque · /precificacao Precificação · /compras Compras · /ferramentas Ferramentas · /governanca Governança · /enxoval Enxoval · /vistorias Vistorias ·
/funcionarios Funcionários · /escala Escala · /escala?aba=banco Banco de horas · /documentos-rh Documentos obrigatórios · /uniformes Uniformes e EPI · /rh Férias e 13º ·
/contador Área do contador · /contratos Contratos · /relatorios Relatórios · /dashboard Dashboard · /tarifas Tarifas · /unidades Unidades · /usuarios Usuários`;

const SISTEMA = `Você é o assistente do VB Hotéis, sistema de gestão de motel, hotel e pousada no Brasil.
Responde a donos, gerentes e recepcionistas que não são da área de tecnologia: português do Brasil simples, frases curtas, sem termos técnicos.
Use as ferramentas para buscar os dados reais antes de responder; nunca invente número. Se uma ferramenta disser que a pessoa não tem permissão, diga isso com educação.
Valores em reais no formato R$ 1.234,56 e datas no formato dd/mm/aaaa.
Quando fizer sentido, termine indicando a tela onde a pessoa resolve, como link em markdown, por exemplo [Escala](/escala). Use só estas telas:
${TELAS}
Você só consulta: não muda, não lança e não apaga nada. Se pedirem para fazer algo (lançar, cancelar, emitir), explique o passo a passo e indique a tela.
Seja breve: no máximo uns 8 itens em listas.`;

class MensagemDto {
  @IsIn(['user', 'assistant']) papel!: 'user' | 'assistant';
  @IsString() @MaxLength(6000) texto!: string;
}
class PerguntaDto {
  @IsString() @MinLength(2) @MaxLength(1000) pergunta!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => MensagemDto) historico?: MensagemDto[];
}

@Injectable()
export class AssistenteService {
  private readonly log = new Logger('Assistente');
  private readonly ia = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  constructor(private readonly ds: DataSource) {}

  private ferramentas(u: UsuarioToken) {
    const pode = (...p: string[]) => p.some((x) => temPermissao(u, x));
    const sem = (o: string) => JSON.stringify({ erro: `Sem permissão para ver ${o}.` });
    const q = (sql: string, p: unknown[]) => this.ds.query(sql, p) as Promise<Record<string, unknown>[]>;

    return [
      betaZodTool({
        name: 'situacao_agora',
        description: 'Situação de agora: quantos quartos/suítes livres, ocupados, em limpeza, bloqueados, reservados (com os números), contas abertas e entradas de hoje.',
        inputSchema: z.object({}),
        run: async () => {
          const st = await q(`SELECT status, count(*)::int AS qtd, string_agg(codigo, ', ' ORDER BY codigo) AS quais FROM unidades WHERE empresa_id = $1 AND ativo GROUP BY status`, [u.empresaId]);
          const [e] = await q(
            `SELECT count(*) FILTER (WHERE status = 'aberta')::int AS abertas,
                    count(*) FILTER (WHERE (entrada_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)::int AS entradas_hoje
               FROM estadias WHERE empresa_id = $1`, [u.empresaId]);
          return JSON.stringify({ hoje: hojeSP(), unidadesPorSituacao: st.map((x) => ({ situacao: x.status, quantidade: n(x.qtd), quais: String(x.quais ?? '').slice(0, 300) })), contasAbertas: n(e?.abertas), entradasHoje: n(e?.entradas_hoje) });
        },
      }),
      betaZodTool({
        name: 'reservas_do_dia',
        description: 'Reservas que chegam e que saem numa data (hotel/pousada). Para "quem chega amanhã" passe a data de amanhã.',
        inputSchema: z.object({ data: DATA.describe('AAAA-MM-DD') }),
        run: async ({ data }) => {
          if (!pode('reservas.gerenciar', 'estadias.operar', 'estadias.entrada', 'painel.ver')) return sem('reservas');
          const l = await q(
            `SELECT r.numero, r.hospede, r.telefone, r.chegada, r.saida, r.adultos, r.criancas, r.status, r.valor_total, r.sinal, un.codigo AS quarto
               FROM reservas r LEFT JOIN unidades un ON un.id = r.unidade_id
              WHERE r.empresa_id = $1 AND r.status NOT IN ('cancelada') AND (r.chegada = $2 OR r.saida = $2) ORDER BY r.chegada, un.codigo LIMIT 80`, [u.empresaId, data]);
          return JSON.stringify({
            data,
            chegam: l.filter((r) => dia(r.chegada) === data).map((r) => ({ numero: r.numero, hospede: r.hospede, quarto: r.quarto, pessoas: n(r.adultos) + n(r.criancas), status: r.status, total: n(r.valor_total), sinal: n(r.sinal) })),
            saem: l.filter((r) => dia(r.saida) === data).map((r) => ({ numero: r.numero, hospede: r.hospede, quarto: r.quarto, status: r.status })),
          });
        },
      }),
      betaZodTool({
        name: 'procurar_reserva',
        description: 'Procura reservas pelo nome do hóspede ou telefone.',
        inputSchema: z.object({ texto: z.string().min(2).max(60) }),
        run: async ({ texto }) => {
          if (!pode('reservas.gerenciar', 'estadias.operar', 'estadias.entrada')) return sem('reservas');
          const l = await q(
            `SELECT r.numero, r.hospede, r.telefone, r.chegada, r.saida, r.status, r.valor_total, un.codigo AS quarto FROM reservas r LEFT JOIN unidades un ON un.id = r.unidade_id
              WHERE r.empresa_id = $1 AND (r.hospede ILIKE $2 OR regexp_replace(COALESCE(r.telefone,''), '\\D', '', 'g') LIKE $3) ORDER BY r.chegada DESC LIMIT 15`,
            [u.empresaId, `%${texto}%`, `%${texto.replace(/\D/g, '') || '@@'}%`]);
          return JSON.stringify(l.map((r) => ({ ...r, chegada: dia(r.chegada), saida: dia(r.saida), valor_total: n(r.valor_total) })));
        },
      }),
      betaZodTool({
        name: 'vendas',
        description: 'Vendas (contas fechadas) num período: quantidade, faturamento total, ticket médio e total por dia.',
        inputSchema: z.object({ de: DATA, ate: DATA }),
        run: async ({ de, ate }) => {
          if (!pode('relatorios.ver', 'caixa.adm', 'caixa.relatorios')) return sem('vendas');
          const l = await q(
            `SELECT (saida_em AT TIME ZONE 'America/Sao_Paulo')::date AS dia, count(*)::int AS contas, COALESCE(sum(valor_total), 0) AS total
               FROM estadias WHERE empresa_id = $1 AND status = 'fechada' AND (saida_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1`, [u.empresaId, de, ate]);
          const total = l.reduce((s, x) => s + n(x.total), 0);
          const contas = l.reduce((s, x) => s + n(x.contas), 0);
          return JSON.stringify({ de, ate, contas, total: Math.round(total * 100) / 100, ticketMedio: contas ? Math.round((total / contas) * 100) / 100 : 0, porDia: l.slice(-31).map((x) => ({ dia: dia(x.dia), contas: n(x.contas), total: n(x.total) })) });
        },
      }),
      betaZodTool({
        name: 'contas_a_pagar',
        description: 'Contas a pagar em aberto: vencidas e as que vencem até a data informada.',
        inputSchema: z.object({ ate: DATA }),
        run: async ({ ate }) => {
          if (!pode('despesas.gerenciar', 'caixa.adm', 'despesas.aprovar')) return sem('contas a pagar');
          const l = await q(
            `SELECT descricao, fornecedor, valor, vencimento FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND vencimento <= $2 ORDER BY vencimento LIMIT 60`, [u.empresaId, ate]);
          const hoje = hojeSP();
          return JSON.stringify({
            hoje, total: Math.round(l.reduce((s, x) => s + n(x.valor), 0) * 100) / 100,
            vencidas: l.filter((x) => dia(x.vencimento) < hoje).length,
            contas: l.map((x) => ({ descricao: x.descricao, fornecedor: x.fornecedor, valor: n(x.valor), vencimento: dia(x.vencimento) })),
          });
        },
      }),
      betaZodTool({
        name: 'a_receber',
        description: 'O que empresas e clientes faturados devem (a receber), com o que já venceu.',
        inputSchema: z.object({}),
        run: async () => {
          if (!pode('faturamento.gerenciar', 'relatorios.ver', 'caixa.adm')) return sem('o faturamento');
          const l = await q(
            `SELECT c.nome, sum(r.valor) AS devendo, sum(r.valor) FILTER (WHERE r.vencimento < (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS vencido
               FROM contas_receber r JOIN clientes_faturados c ON c.id = r.cliente_id WHERE r.empresa_id = $1 AND r.status = 'aberta' GROUP BY c.nome ORDER BY 2 DESC LIMIT 30`, [u.empresaId]);
          return JSON.stringify(l.map((x) => ({ cliente: x.nome, devendo: n(x.devendo), vencido: n(x.vencido) })));
        },
      }),
      betaZodTool({
        name: 'estoque_baixo',
        description: 'Produtos com estoque abaixo do mínimo (para comprar).',
        inputSchema: z.object({}),
        run: async () => {
          if (!pode('estoque.gerenciar', 'produtos.gerenciar', 'compras.gerenciar')) return sem('o estoque');
          const l = await q(
            `SELECT p.nome, p.estoque_minimo, COALESCE(sum(s.quantidade), 0) AS tem FROM produtos p LEFT JOIN estoque_saldos s ON s.produto_id = p.id
              WHERE p.empresa_id = $1 AND p.ativo AND p.controla_estoque AND p.estoque_minimo > 0 GROUP BY p.id, p.nome, p.estoque_minimo
             HAVING COALESCE(sum(s.quantidade), 0) < p.estoque_minimo ORDER BY p.nome LIMIT 60`, [u.empresaId]);
          return JSON.stringify(l.map((x) => ({ produto: x.nome, tem: n(x.tem), minimo: n(x.estoque_minimo) })));
        },
      }),
      betaZodTool({
        name: 'equipe_do_dia',
        description: 'Quem trabalha, folga, faltou ou está de atestado numa data (escala).',
        inputSchema: z.object({ data: DATA }),
        run: async ({ data }) => {
          if (!pode('funcionarios.gerenciar', 'funcionarios.financeiro')) return sem('a escala');
          const l = await q(
            `SELECT f.nome, f.funcao, d.tipo FROM escala_dias d JOIN funcionarios f ON f.id = d.funcionario_id WHERE d.empresa_id = $1 AND d.data = $2 ORDER BY d.tipo, f.nome`, [u.empresaId, data]);
          return JSON.stringify({ data, equipe: l.map((x) => ({ nome: x.nome, funcao: x.funcao, situacao: x.tipo })) });
        },
      }),
      betaZodTool({
        name: 'pedidos_de_quarto',
        description: 'Pedidos do serviço de quartos em aberto (novos, preparando, a caminho) e há quantos minutos.',
        inputSchema: z.object({}),
        run: async () => {
          const l = await q(
            `SELECT un.codigo, p.status, p.itens, p.total, round(extract(epoch FROM now() - p.criado_em) / 60)::int AS minutos
               FROM pedidos p JOIN unidades un ON un.id = p.unidade_id WHERE p.empresa_id = $1 AND p.status IN ('novo','aceito','saiu') AND p.criado_em > now() - interval '1 day' ORDER BY p.criado_em`, [u.empresaId]);
          return JSON.stringify(l.map((x) => ({ quarto: x.codigo, situacao: x.status, minutos: n(x.minutos), total: n(x.total), itens: (x.itens as { nome: string; quantidade: number }[]).map((i) => `${i.quantidade}x ${i.nome}`).join(', ') })));
        },
      }),
    ];
  }

  async perguntar(u: UsuarioToken, dto: PerguntaDto) {
    if (!this.ia) throw new ServiceUnavailableException('A inteligência artificial não está ligada neste servidor. Fale com a Virtual Barra.');
    const historico: Anthropic.Beta.BetaMessageParam[] = (dto.historico ?? []).filter((m) => m.texto.trim()).map((m) => ({ role: m.papel, content: m.texto }));
    while (historico.length && historico[0].role !== 'user') historico.shift();
    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    const contexto = `Empresa: ${emp?.nome ?? ''}. Quem pergunta: ${u.nome}. Hoje é ${hojeSP()} (horário de Brasília).`;
    try {
      const runner = this.ia.beta.messages.toolRunner({
        model: 'claude-opus-5-5',
        max_tokens: 6000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        max_iterations: 8,
        system: [{ type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } }, { type: 'text', text: contexto }],
        tools: this.ferramentas(u),
        messages: [...historico, { role: 'user', content: dto.pergunta.trim() }],
      });
      const final = await runner;
      if (final.stop_reason === 'refusal') return { resposta: 'Não consigo responder essa pergunta. Tente perguntar de outro jeito.' };
      const texto = final.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { resposta: texto || 'Não encontrei uma resposta. Tente perguntar de outro jeito.' };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ServiceUnavailableException('Muitas perguntas ao mesmo tempo. Espere um minuto e tente de novo.');
      if (e instanceof Anthropic.BadRequestError) { this.log.warn(`IA recusou o pedido: ${e.message}`); throw new BadRequestException('Não consegui entender essa pergunta. Tente de outro jeito.'); }
      if (e instanceof Anthropic.APIError) { this.log.warn(`Erro da IA ${e.status}: ${e.message}`); throw new ServiceUnavailableException('A inteligência artificial não respondeu agora. Tente de novo em instantes.'); }
      throw e;
    }
  }
}

@Controller('assistente')
export class AssistenteController {
  constructor(private readonly service: AssistenteService) {}

  /** qualquer usuário logado pode perguntar; cada consulta confere a permissão dele */
  @Post() @HttpCode(200)
  perguntar(@Usuario() u: UsuarioToken, @Body() dto: PerguntaDto) { return this.service.perguntar(u, dto); }
}

@Module({ providers: [AssistenteService], controllers: [AssistenteController] })
export class AssistenteModule {}
