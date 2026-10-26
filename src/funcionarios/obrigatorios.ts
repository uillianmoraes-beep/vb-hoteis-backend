import { Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { TIPOS_DOCUMENTO } from './documentos';

/**
 * Documentos obrigatórios do RH: o que cada funcionário precisa ter guardado (admissão, durante o contrato e na saída),
 * conforme a situação dele (CLT, dependentes, vale-transporte, banco de horas, EPI, demitido).
 * Mostra o que falta e o que venceu; os termos que a empresa preenche (VT, salário-família, dependentes do IR,
 * acordo de compensação, LGPD, ficha de registro) saem prontos para imprimir e assinar.
 */

type Tipo = keyof typeof TIPOS_DOCUMENTO;
interface Exigencia { tipo: Tipo; porque: string; quando: 'admissao' | 'contrato' | 'saida'; modelo?: boolean }

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const CLT = new Set(['clt', 'experiencia', 'intermitente']);
/** modelos que o sistema preenche para imprimir */
export const MODELOS = {
  vt: 'Termo de opção do vale-transporte', salario_familia: 'Termo de responsabilidade do salário-família', dependentes_ir: 'Declaração de dependentes para o IR',
  compensacao: 'Acordo de compensação de horas / banco de horas', lgpd: 'Termo de ciência do uso de dados (LGPD)', registro: 'Ficha de registro do empregado',
} as const;

/** o que a lei pede para cada situação */
export function exigencias(f: { tipoContrato: string | null; dependentes: number; temVt: boolean; temEscala: boolean; temEpi: boolean; demitido: boolean }): Exigencia[] {
  const clt = CLT.has(f.tipoContrato ?? 'clt');
  const l: Exigencia[] = [
    { tipo: 'rg', porque: 'identificação', quando: 'admissao' },
    { tipo: 'cpf', porque: 'cadastro no eSocial', quando: 'admissao' },
    { tipo: 'residencia', porque: 'endereço no registro', quando: 'admissao' },
  ];
  if (clt) {
    l.push(
      { tipo: 'ctps', porque: 'CLT art. 29 (carteira digital: print ou PDF)', quando: 'admissao' },
      { tipo: 'pis', porque: 'PIS/NIS para o eSocial e FGTS', quando: 'admissao' },
      { tipo: 'aso', porque: 'exame admissional e periódico (NR-7)', quando: 'admissao' },
      { tipo: 'contrato', porque: 'contrato de trabalho assinado', quando: 'admissao' },
      { tipo: 'registro', porque: 'ficha de registro (CLT art. 41)', quando: 'admissao', modelo: true },
      { tipo: 'vt', porque: f.temVt ? 'recebe vale-transporte' : 'opção ou recusa do vale-transporte (Decreto 10.854)', quando: 'admissao', modelo: true },
      { tipo: 'lgpd', porque: 'uso dos dados pessoais (LGPD)', quando: 'admissao', modelo: true },
    );
    if (f.dependentes > 0) {
      l.push(
        { tipo: 'filhos', porque: 'certidão/CPF dos dependentes', quando: 'admissao' },
        { tipo: 'dependentes_ir', porque: 'desconto de dependentes no IR', quando: 'admissao', modelo: true },
        { tipo: 'salario_familia', porque: 'termo do salário-família (filhos até 14 anos)', quando: 'admissao', modelo: true },
      );
    }
    if (f.temEscala) l.push({ tipo: 'compensacao', porque: 'escala com banco de horas ou compensação (CLT art. 59)', quando: 'contrato', modelo: true });
    if (f.temEpi) l.push({ tipo: 'ficha_epi', porque: 'recebeu EPI (NR-6): ficha assinada', quando: 'contrato' });
    if (f.demitido) {
      l.push(
        { tipo: 'aviso_previo', porque: 'aviso prévio ou pedido de demissão', quando: 'saida' },
        { tipo: 'trct', porque: 'termo de rescisão assinado', quando: 'saida' },
        { tipo: 'fgts', porque: 'guia da multa / extrato do FGTS', quando: 'saida' },
        { tipo: 'seguro_desemprego', porque: 'guias do seguro-desemprego (dispensa sem justa causa)', quando: 'saida' },
      );
    }
  }
  return l;
}

@Injectable()
export class ObrigatoriosService {
  constructor(private readonly ds: DataSource) {}

  /** situação de todos: ativos e quem saiu nos últimos 90 dias */
  async checklist(u: UsuarioToken) {
    const hoje = hojeSP();
    const funcs: Record<string, unknown>[] = await this.ds.query(
      `SELECT f.id, f.nome, f.funcao, f.admissao, f.ativo, c.cargo, c.tipo_contrato, c.dependentes, c.beneficios, c.demissao,
              EXISTS (SELECT 1 FROM escala_dias d WHERE d.funcionario_id = f.id AND (d.tipo = 'compensa' OR COALESCE(d.minutos_banco, 0) <> 0)) AS tem_escala
         FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id
        WHERE f.empresa_id = $1 AND (f.ativo OR c.demissao >= ($2::date - 90))
        ORDER BY f.ativo DESC, f.nome`, [u.empresaId, hoje]).catch(async () => this.ds.query(
      `SELECT f.id, f.nome, f.funcao, f.admissao, f.ativo, c.cargo, c.tipo_contrato, c.dependentes, c.beneficios, c.demissao, false AS tem_escala
         FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id WHERE f.empresa_id = $1 AND f.ativo ORDER BY f.nome`, [u.empresaId]));
    const epi: { funcionario_id: string }[] = await this.ds.query(
      `SELECT DISTINCT e.funcionario_id FROM uniforme_entregas e JOIN uniforme_itens i ON i.id = e.item_id WHERE e.empresa_id = $1 AND i.tipo IN ('epi','calcado')`, [u.empresaId]).catch(() => []);
    const comEpi = new Set(epi.map((x) => x.funcionario_id));
    const docs: { funcionario_id: string; tipo: string; validade: unknown }[] = await this.ds.query(
      `SELECT funcionario_id, tipo, max(validade) AS validade FROM funcionario_documentos WHERE empresa_id = $1 GROUP BY 1, 2`, [u.empresaId]);
    const mapa = new Map<string, Map<string, string | null>>();
    for (const d of docs) {
      const m = mapa.get(d.funcionario_id) ?? new Map<string, string | null>();
      m.set(d.tipo, dia(d.validade));
      mapa.set(d.funcionario_id, m);
    }
    const lista = funcs.map((f) => {
      const bens = (f.beneficios ?? []) as { tipo: string }[];
      const demissao = dia(f.demissao);
      const ex = exigencias({
        tipoContrato: (f.tipo_contrato as string) ?? null, dependentes: Number(f.dependentes ?? 0), temVt: bens.some((b) => b.tipo === 'vt'),
        temEscala: !!f.tem_escala, temEpi: comEpi.has(f.id as string), demitido: !!demissao && demissao <= hoje,
      });
      const tem = mapa.get(f.id as string) ?? new Map<string, string | null>();
      const itens = ex.map((e) => {
        const validade = tem.has(e.tipo) ? tem.get(e.tipo) ?? null : undefined;
        const situacao = validade === undefined ? 'falta' : validade && validade < hoje ? 'vencido' : validade && validade <= somaDias(hoje, 30) ? 'vencendo' : 'ok';
        return { tipo: e.tipo, nome: TIPOS_DOCUMENTO[e.tipo], porque: e.porque, quando: e.quando, modelo: !!e.modelo, situacao, validade: validade ?? null };
      });
      return {
        id: f.id, nome: f.nome, funcao: f.cargo ?? f.funcao, admissao: dia(f.admissao), demissao, ativo: !!f.ativo, tipoContrato: f.tipo_contrato ?? null,
        semContrato: !f.tipo_contrato, itens,
        faltam: itens.filter((i) => i.situacao === 'falta').length, vencidos: itens.filter((i) => i.situacao === 'vencido').length,
        vencendo: itens.filter((i) => i.situacao === 'vencendo').length, ok: itens.filter((i) => i.situacao === 'ok').length,
      };
    });
    return {
      hoje, modelos: MODELOS, lista,
      resumo: {
        funcionarios: lista.length, completos: lista.filter((f) => !f.faltam && !f.vencidos).length,
        faltam: lista.reduce((s, f) => s + f.faltam, 0), vencidos: lista.reduce((s, f) => s + f.vencidos, 0), vencendo: lista.reduce((s, f) => s + f.vencendo, 0),
      },
    };
  }

  /** dados para preencher os modelos (termos para assinar) */
  async dadosModelo(u: UsuarioToken, funcionarioId: string) {
    const [f] = await this.ds.query(
      `SELECT f.*, c.cargo, c.salario, c.tipo_contrato, c.jornada, c.horas_semana, c.dependentes, c.beneficios, c.demissao
         FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id WHERE f.id = $1 AND f.empresa_id = $2`, [funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    const [e] = await this.ds.query(`SELECT * FROM empresas WHERE id = $1`, [u.empresaId]);
    const [a] = await this.ds.query(`SELECT razao_social, nome, cnpj FROM ambientes WHERE empresa_id = $1 AND COALESCE(cnpj, '') <> '' ORDER BY nome LIMIT 1`, [u.empresaId]).catch(() => []);
    const bens = (f.beneficios ?? []) as { tipo: string; valor: number; por: string }[];
    return {
      hoje: hojeSP(),
      empresa: { nome: a?.razao_social || e?.nome || '', cnpj: a?.cnpj || e?.cnpj || null, endereco: e?.endereco ?? null, cidade: e?.cidade ?? null },
      funcionario: {
        nome: f.nome, cpf: f.documento, telefone: f.telefone, funcao: f.cargo ?? f.funcao, matricula: f.matricula, admissao: dia(f.admissao), demissao: dia(f.demissao),
        salario: f.salario === null || f.salario === undefined ? null : Number(f.salario), tipoContrato: f.tipo_contrato ?? null, jornada: f.jornada ?? null,
        horasSemana: f.horas_semana === null || f.horas_semana === undefined ? null : Number(f.horas_semana), dependentes: Number(f.dependentes ?? 0),
        vt: bens.find((b) => b.tipo === 'vt') ?? null, chavePix: f.chave_pix ?? null,
      },
    };
  }
}
const somaDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

@Controller('rh/documentos')
export class ObrigatoriosController {
  constructor(private readonly service: ObrigatoriosService) {}

  @Get('checklist')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  checklist(@Usuario() u: UsuarioToken) { return this.service.checklist(u); }

  @Get('modelo/:funcionarioId')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  modelo(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string) { return this.service.dadosModelo(u, id); }
}
