import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Contrato do funcionário (só para quem cuida do RH): cargo, salário, tipo de contrato, jornada e benefícios.
 * Cada troca de salário ou cargo fica no histórico (data, % e motivo). É a base para conferir o holerite
 * do contador, as provisões (férias, 13º) e a reserva da folha.
 */

export const TIPOS_CONTRATO = { clt: 'CLT', experiencia: 'CLT (experiência)', intermitente: 'Intermitente', estagio: 'Estágio', diarista: 'Diarista / freelancer', pj: 'PJ / MEI' } as const;
export const JORNADAS = { '6x1': '6x1', '5x2': '5x2', '12x36': '12x36', parcial: 'Tempo parcial', outra: 'Outra' } as const;
/** benefícios: cada hotel escolhe (ex.: vale-combustível no lugar do vale-transporte) */
export const BENEFICIOS = {
  vt: 'Vale-transporte', combustivel: 'Vale-combustível / ajuda de combustível', va: 'Vale-alimentação', vr: 'Vale-refeição', cesta: 'Cesta básica',
  saude: 'Plano de saúde', ppr: 'PPR / participação nos lucros', abono: 'Abono', gratificacao: 'Gratificação', outro: 'Outro',
} as const;

class BeneficioDto {
  @IsIn(Object.keys(BENEFICIOS)) tipo!: keyof typeof BENEFICIOS;
  @IsOptional() @IsString() @MaxLength(60) nome?: string;
  /** valor por mês ou por dia trabalhado */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) valor!: number;
  @IsIn(['mes', 'dia']) por!: 'mes' | 'dia';
  /** dias por mês (quando é por dia; ex.: 22) */
  @IsOptional() @IsInt() @Min(0) @Max(31) dias?: number;
  /** quanto desconta do funcionário, em % do salário (ex.: VT até 6%) */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) descontoPct?: number;
}
class ContratoDto {
  @IsOptional() @IsString() @MaxLength(80) cargo?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1_000_000) salario?: number | null;
  @IsIn(Object.keys(TIPOS_CONTRATO)) tipoContrato!: string;
  @IsOptional() @IsIn(Object.keys(JORNADAS)) jornada?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(80) horasSemana?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(20) dependentes?: number;
  @IsOptional() @IsBoolean() adicionalNoturno?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) insalubridadePct?: number | null;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => BeneficioDto) beneficios!: BeneficioDto[];
  @IsOptional() @Matches(/^(\d{4}-\d{2}-\d{2})?$/) demissao?: string;
  /** mudou salário ou cargo: motivo e data (ex.: reajuste do sindicato, promoção) */
  @IsOptional() @IsString() @MaxLength(200) motivo?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde?: string;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/** custo mensal dos benefícios (o que a casa paga, já sem o desconto do funcionário) */
export function custoBeneficios(salario: number, bens: { valor: number; por: string; dias?: number; descontoPct?: number }[]) {
  let custo = 0, desconto = 0;
  for (const b of bens) {
    const bruto = b.por === 'dia' ? b.valor * (b.dias ?? 22) : b.valor;
    const desc = b.descontoPct ? Math.min(bruto, (salario * b.descontoPct) / 100) : 0;
    custo += bruto - desc;
    desconto += desc;
  }
  return { custo: r2(custo), desconto: r2(desconto) };
}

@Injectable()
export class ContratoService {
  constructor(private readonly ds: DataSource) {}

  private async funcionario(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT id, nome, admissao FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    return f;
  }

  async ver(u: UsuarioToken, id: string) {
    const f = await this.funcionario(u, id);
    const [c] = await this.ds.query(`SELECT * FROM funcionario_contratos WHERE funcionario_id = $1`, [id]);
    const historico = (await this.ds.query(`SELECT * FROM funcionario_salarios WHERE funcionario_id = $1 ORDER BY data DESC, criado_em DESC LIMIT 100`, [id]))
      .map((h: Record<string, unknown>) => ({ data: dia(h.data), cargo: h.cargo, salario: n(h.salario), salarioAnterior: n(h.salario_anterior), percentual: n(h.percentual), motivo: h.motivo, usuario: h.usuario_nome }));
    const salario = n(c?.salario) ?? 0;
    const bens = (c?.beneficios ?? []) as BeneficioDto[];
    return {
      funcionario: { id: f.id, nome: f.nome, admissao: dia(f.admissao) },
      contrato: c ? {
        cargo: c.cargo, salario: n(c.salario), tipoContrato: c.tipo_contrato, jornada: c.jornada, horasSemana: n(c.horas_semana), dependentes: c.dependentes,
        adicionalNoturno: c.adicional_noturno, insalubridadePct: n(c.insalubridade_pct), beneficios: bens, demissao: dia(c.demissao),
      } : null,
      custoBeneficios: custoBeneficios(salario, bens),
      historico, tipos: { contratos: TIPOS_CONTRATO, jornadas: JORNADAS, beneficios: BENEFICIOS },
    };
  }

  async salvar(u: UsuarioToken, id: string, dto: ContratoDto) {
    await this.funcionario(u, id);
    const [antes] = await this.ds.query(`SELECT cargo, salario FROM funcionario_contratos WHERE funcionario_id = $1`, [id]);
    const salario = dto.salario ?? null;
    const cargo = dto.cargo?.trim() || null;
    const mudouSalario = (n(antes?.salario) ?? null) !== salario;
    const mudouCargo = (antes?.cargo ?? null) !== cargo;
    if (antes && (mudouSalario || mudouCargo) && !dto.motivo?.trim()) throw new BadRequestException('Mudou o salário ou o cargo: diga o motivo (ex.: reajuste do sindicato, promoção).');
    await this.ds.transaction(async (m) => {
      await m.query(
        `INSERT INTO funcionario_contratos (funcionario_id, empresa_id, cargo, salario, tipo_contrato, jornada, horas_semana, dependentes, adicional_noturno, insalubridade_pct, beneficios, demissao, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12, now())
         ON CONFLICT (funcionario_id) DO UPDATE SET cargo=$3, salario=$4, tipo_contrato=$5, jornada=$6, horas_semana=$7, dependentes=$8, adicional_noturno=$9,
           insalubridade_pct=$10, beneficios=$11::jsonb, demissao=$12, atualizado_em=now()`,
        [id, u.empresaId, cargo, salario === null ? null : salario.toFixed(2), dto.tipoContrato, dto.jornada ?? null, dto.horasSemana ?? null, dto.dependentes ?? 0,
          !!dto.adicionalNoturno, dto.insalubridadePct ?? null, JSON.stringify(dto.beneficios ?? []), dto.demissao || null]);
      if (!antes || mudouSalario || mudouCargo) {
        const ant = n(antes?.salario);
        await m.query(
          `INSERT INTO funcionario_salarios (empresa_id, funcionario_id, data, cargo, salario, salario_anterior, percentual, motivo, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [u.empresaId, id, dto.desde || hojeSP(), cargo, salario, ant, ant && salario ? r2(((salario - ant) / ant) * 100) : null,
            dto.motivo?.trim() || (antes ? null : 'Cadastro inicial'), u.nome]);
      }
    });
    return this.ver(u, id);
  }

  /** resumo da equipe: salários e benefícios (para a folha da reserva e as provisões) */
  async equipe(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT f.id, f.nome, f.funcao, f.admissao, c.cargo, c.salario, c.tipo_contrato, c.beneficios, c.demissao
         FROM funcionarios f LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id
        WHERE f.empresa_id = $1 AND f.ativo ORDER BY f.nome`, [u.empresaId]);
    const lista = l.map((x: Record<string, unknown>) => {
      const salario = n(x.salario) ?? 0;
      const b = custoBeneficios(salario, (x.beneficios ?? []) as BeneficioDto[]);
      return { id: x.id, nome: x.nome, funcao: x.funcao, cargo: x.cargo, admissao: dia(x.admissao), tipoContrato: x.tipo_contrato ?? null, salario: n(x.salario), beneficios: b.custo, semSalario: x.salario === null };
    });
    return {
      lista,
      totais: {
        salarios: r2(lista.reduce((s: number, x: { salario: number | null }) => s + (x.salario ?? 0), 0)),
        beneficios: r2(lista.reduce((s: number, x: { beneficios: number }) => s + x.beneficios, 0)),
        semSalario: lista.filter((x: { semSalario: boolean }) => x.semSalario).length,
      },
    };
  }
}

@Controller('funcionarios')
export class ContratoController {
  constructor(private readonly service: ContratoService) {}

  @Get('equipe/custos')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  equipe(@Usuario() u: UsuarioToken) {
    return this.service.equipe(u);
  }

  @Get(':id/contrato')
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  ver(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.ver(u, id);
  }

  @Put(':id/contrato')
  @Requer('funcionarios.gerenciar')
  salvar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContratoDto) {
    return this.service.salvar(u, id, dto);
  }
}
