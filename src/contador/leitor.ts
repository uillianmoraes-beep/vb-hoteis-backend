import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

/**
 * Lê o que o contador entrega (holerite, extrato do Simples/PGDAS-D) em PDF ou foto, com o Claude, e devolve os números
 * para o RH conferir antes de salvar. Sem ANTHROPIC_API_KEY no servidor, o RH digita à mão.
 */

const TIPOS: Record<string, 'application/pdf' | 'image/jpeg' | 'image/png'> = { 'application/pdf': 'application/pdf', 'image/jpeg': 'image/jpeg', 'image/png': 'image/png' };
const MAX_BYTES = 8_000_000;

const num = () => z.number().describe('valor em reais com ponto decimal (ex.: 4009.50); 0 se não houver');

export const HoleriteIa = z.object({
  funcionario: z.string().describe('nome do funcionário como está no holerite'),
  cargo: z.string().describe('cargo/função, vazio se não houver'),
  cnpj: z.string().describe('CNPJ da empresa, só números, vazio se não houver'),
  competencia: z.string().describe('mês de referência no formato AAAA-MM'),
  tipo: z.enum(['mensal', 'adiantamento', 'ferias', 'decimo1', 'decimo2', 'rescisao']).describe('mensal = folha normal'),
  rubricas: z.array(z.object({
    codigo: z.string().describe('código da rubrica, vazio se não houver'),
    descricao: z.string(),
    referencia: z.string().describe('coluna Referência como está escrita (ex.: 220:00, 9,35, 30), vazio se não houver'),
    vencimento: num(),
    desconto: num(),
  })),
  salarioBase: num(), baseInss: num().describe('Sal. Contr. INSS / base do INSS'), baseFgts: num(), fgtsMes: num(),
  baseIrrf: num(), faixaIrrf: num().describe('percentual da faixa do IRRF, 0 se não houver'),
  totalVencimentos: num(), totalDescontos: num(), liquido: num(),
});
export type HoleriteLido = z.infer<typeof HoleriteIa>;

const tributos = z.object({ irpj: num(), csll: num(), cofins: num(), pis: num(), cpp: num().describe('INSS/CPP'), icms: num(), ipi: num(), iss: num() });
export const SimplesIa = z.object({
  cnpj: z.string().describe('CNPJ do estabelecimento (14 dígitos, só números) ou o CNPJ básico (8 dígitos) se só houver ele'),
  nome: z.string().describe('nome empresarial'),
  competencia: z.string().describe('período de apuração (PA) no formato AAAA-MM'),
  receitaPa: num().describe('receita bruta do PA (mês)'),
  rbt12: num().describe('receita bruta acumulada nos 12 meses anteriores'),
  rba: num().describe('receita bruta acumulada no ano corrente'),
  rbaa: num().describe('receita bruta acumulada no ano anterior'),
  sublimite: num(),
  receitasAnteriores: z.array(z.object({ competencia: z.string().describe('AAAA-MM'), valor: num() })).describe('quadro 2.2.1 mercado interno, mês a mês'),
  atividades: z.array(z.object({
    descricao: z.string().describe('texto da atividade (ex.: Revenda de mercadorias … com substituição tributária)'),
    receita: num().describe('receita bruta informada da atividade'),
    tributos, total: num(),
  })),
  totalDas: num().describe('valor total do DAS (principal + multa + juros)'),
  principal: num(), multa: num(), juros: num(),
  vencimento: z.string().describe('data de vencimento do DAS no formato AAAA-MM-DD, vazio se não houver'),
  numeroDas: z.string().describe('número do DAS, vazio se não houver'),
  pagamentoReconhecido: z.boolean().describe('true se o extrato diz que o pagamento foi reconhecido'),
});
export type SimplesLido = z.infer<typeof SimplesIa>;

@Injectable()
export class LeitorContadorService {
  private readonly log = new Logger('LeitorContador');
  private readonly ia = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  get disponivel() {
    return !!this.ia;
  }

  /** confere o arquivo (data:…;base64,…) e devolve tipo e conteúdo */
  arquivo(dataUrl: string) {
    const m = /^data:([a-z/]+);base64,/.exec(dataUrl);
    const mime = m ? TIPOS[m[1]] : undefined;
    if (!m || !mime) throw new BadRequestException('Envie o arquivo em PDF (ou uma foto JPG/PNG).');
    const base64 = dataUrl.slice(m[0].length).replace(/\s/g, '');
    const bin = Buffer.from(base64, 'base64');
    if (!bin.length) throw new BadRequestException('O arquivo está vazio.');
    if (bin.length > MAX_BYTES) throw new BadRequestException('Arquivo grande demais (máximo 8 MB).');
    if (mime === 'application/pdf' && bin.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('Esse arquivo não é um PDF de verdade.');
    return { mime, base64, bin, ext: mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg' };
  }

  private async ler<T extends z.ZodTypeAny>(dataUrl: string, esquema: T, instrucao: string): Promise<z.infer<T>> {
    if (!this.ia) throw new ServiceUnavailableException('A leitura automática não está ligada neste servidor (falta a chave da IA). Digite os valores à mão.');
    const a = this.arquivo(dataUrl);
    const bloco: Anthropic.Beta.BetaContentBlockParam = a.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: a.mime, data: a.base64 } };
    try {
      // fallbacks: se o modelo recusar, a própria API tenta outro modelo na mesma chamada
      const r = await this.ia.beta.messages.parse({
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'medium', format: zodOutputFormat(esquema) },
        system: 'Você lê documentos de departamento pessoal e fiscal brasileiros (holerites, extratos do Simples Nacional) e copia os números exatamente como estão, '
          + 'sem calcular nem corrigir nada. Valores em reais com ponto decimal. Se um campo não existir no documento, use 0 ou texto vazio.',
        messages: [{ role: 'user', content: [bloco, { type: 'text', text: instrucao }] }],
      });
      if (r.stop_reason === 'refusal' || !r.parsed_output) throw new BadRequestException('Não consegui ler este arquivo. Confira se é o documento certo e legível, ou digite à mão.');
      return r.parsed_output as z.infer<T>;
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.log.warn(`leitura falhou: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException('A leitura automática falhou agora. Tente de novo ou digite os valores à mão.');
    }
  }

  lerHolerite(dataUrl: string) {
    return this.ler(dataUrl, HoleriteIa, 'Este é um holerite (demonstrativo de pagamento). Copie o cabeçalho, todas as rubricas (código, descrição, referência, vencimento, desconto) '
      + 'e o rodapé (salário base, base do INSS, base do FGTS, FGTS do mês, base do IRRF, faixa do IRRF, totais e líquido). Se houver duas vias iguais, leia uma só.');
  }

  lerSimples(dataUrl: string) {
    return this.ler(dataUrl, SimplesIa, 'Este é um extrato do Simples Nacional (PGDAS-D). Copie as informações do contribuinte, o discriminativo de receitas, '
      + 'as receitas brutas anteriores mês a mês (mercado interno), cada atividade com a receita informada e os tributos, e os dados do DAS gerado.');
  }
}
