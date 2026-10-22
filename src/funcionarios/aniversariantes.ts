import { Body, Controller, Get, Injectable, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken, temPermissao } from '../common/permissoes';

/**
 * Aniversariantes do mês: hóspedes (data de nascimento da ficha FNRH) e funcionários,
 * com a mensagem pronta ({nome} vira o primeiro nome) para imprimir ou mandar pelo WhatsApp.
 */

const PADRAO = {
  hospede: 'Feliz aniversário, {nome}! 🎉 Toda a equipe do {empresa} deseja um dia especial. Venha comemorar com a gente: temos um presente esperando por você.',
  funcionario: 'Parabéns, {nome}! 🎂 Obrigado por fazer parte da nossa equipe. Que o seu novo ano seja cheio de saúde e alegria. Equipe {empresa}.',
};

class MensagensDto {
  @IsOptional() @IsString() @MaxLength(600) hospede?: string;
  @IsOptional() @IsString() @MaxLength(600) funcionario?: string;
}

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));

@Injectable()
export class AniversariantesService {
  constructor(private readonly ds: DataSource) {}

  private async mensagens(empresaId: string) {
    const [e] = await this.ds.query(`SELECT nome, config_aniversario FROM empresas WHERE id = $1`, [empresaId]);
    const c = (e?.config_aniversario ?? {}) as { hospede?: string; funcionario?: string };
    return { empresa: e?.nome ?? '', hospede: c.hospede || PADRAO.hospede, funcionario: c.funcionario || PADRAO.funcionario };
  }

  async ver(u: UsuarioToken, mes: string) {
    const m = Number(mes.slice(5, 7));
    const hoje = hojeSP();
    const msg = await this.mensagens(u.empresaId);
    const verHospedes = ['reservas.gerenciar', 'estadias.operar', 'relatorios.ver'].some((p) => temPermissao(u, p));
    const verEquipe = ['funcionarios.gerenciar', 'funcionarios.financeiro'].some((p) => temPermissao(u, p));
    let hospedes: unknown[] = [];
    if (verHospedes) {
      // um por pessoa (documento ou nome), com a última vez que esteve aqui
      const l: { nome: string; nascimento: string; telefone: string | null; email: string | null; documento: string | null; ultima: Date; vezes: number }[] = await this.ds.query(
        `SELECT DISTINCT ON (chave) nome, nascimento, telefone, email, documento, ultima, vezes FROM (
           SELECT f.dados->>'nome' AS nome, f.dados->>'nascimento' AS nascimento, f.dados->>'telefone' AS telefone, f.dados->>'email' AS email,
                  COALESCE(NULLIF(f.dados->>'cpf', ''), NULLIF(f.dados->>'documento', '')) AS documento, f.criado_em AS ultima,
                  lower(COALESCE(NULLIF(f.dados->>'cpf', ''), NULLIF(f.dados->>'documento', ''), f.dados->>'nome')) AS chave,
                  count(*) OVER (PARTITION BY lower(COALESCE(NULLIF(f.dados->>'cpf', ''), NULLIF(f.dados->>'documento', ''), f.dados->>'nome')))::int AS vezes
             FROM fichas_hospede f
            WHERE f.empresa_id = $1 AND f.dados->>'nascimento' ~ '^\\d{4}-\\d{2}-\\d{2}$' AND substr(f.dados->>'nascimento', 6, 2) = lpad($2::text, 2, '0')) x
         ORDER BY chave, ultima DESC`, [u.empresaId, m]);
      hospedes = l.map((h) => ({ tipo: 'hospede', nome: h.nome, nascimento: h.nascimento, telefone: h.telefone, email: h.email, documento: h.documento, ultima: h.ultima, vezes: h.vezes }));
    }
    let equipe: unknown[] = [];
    if (verEquipe) {
      const l = await this.ds.query(
        `SELECT nome, nascimento, telefone, funcao FROM funcionarios WHERE empresa_id = $1 AND ativo AND nascimento IS NOT NULL AND extract(month FROM nascimento) = $2`, [u.empresaId, m]);
      equipe = l.map((f: Record<string, unknown>) => ({ tipo: 'funcionario', nome: f.nome, nascimento: dia(f.nascimento), telefone: f.telefone, funcao: f.funcao }));
    }
    const ordenar = (l: unknown[]) => (l as { nascimento: string }[]).sort((a, b) => a.nascimento.slice(8, 10).localeCompare(b.nascimento.slice(8, 10)));
    return {
      mes, hoje, mensagens: msg, verHospedes, verEquipe,
      hospedes: ordenar(hospedes), equipe: ordenar(equipe),
      semNascimento: verEquipe ? Number((await this.ds.query(`SELECT count(*)::int AS n FROM funcionarios WHERE empresa_id = $1 AND ativo AND nascimento IS NULL`, [u.empresaId]))[0]?.n ?? 0) : 0,
    };
  }

  async salvarMensagens(u: UsuarioToken, dto: MensagensDto) {
    await this.ds.query(`UPDATE empresas SET config_aniversario = $2::jsonb WHERE id = $1`,
      [u.empresaId, JSON.stringify({ hospede: dto.hospede?.trim() || undefined, funcionario: dto.funcionario?.trim() || undefined })]);
    return this.mensagens(u.empresaId);
  }
}

@Controller('aniversariantes')
export class AniversariantesController {
  constructor(private readonly service: AniversariantesService) {}

  @Get()
  @Requer('reservas.gerenciar', 'estadias.operar', 'relatorios.ver', 'funcionarios.gerenciar', 'funcionarios.financeiro')
  ver(@Usuario() u: UsuarioToken, @Query('mes') mes?: string) {
    return this.service.ver(u, mes && /^\d{4}-\d{2}$/.test(mes) ? mes : hojeSP().slice(0, 7));
  }

  @Put('mensagens')
  @Requer('empresa.editar', 'relatorios.ver', 'funcionarios.gerenciar')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: MensagensDto) {
    return this.service.salvarMensagens(u, dto);
  }
}
