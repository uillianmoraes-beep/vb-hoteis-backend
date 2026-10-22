import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Contas bancárias e maquininhas (com a taxa contratada e o prazo de recebimento de cada forma).
 * A taxa é o que a conciliação usa para conferir se a maquininha cobrou certo,
 * e o prazo monta o calendário de recebíveis.
 */

class ContaBancariaDto {
  @IsString() @MinLength(2) @MaxLength(60) nome!: string;
  @IsOptional() @IsString() @MaxLength(60) banco?: string;
  @IsOptional() @IsString() @MaxLength(10) agencia?: string;
  @IsOptional() @IsString() @MaxLength(20) conta?: string;
  @IsOptional() @IsString() @MaxLength(120) chavePix?: string;
  @IsOptional() @IsString() @MaxLength(18) cnpj?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

const TAXA = () => (alvo: object, prop: string) => {
  IsOptional()(alvo, prop);
  IsNumber({ maxDecimalPlaces: 3 })(alvo, prop);
  Min(0)(alvo, prop);
  Max(30)(alvo, prop);
};
const PRAZO = () => (alvo: object, prop: string) => {
  IsOptional()(alvo, prop);
  IsInt()(alvo, prop);
  Min(0)(alvo, prop);
  Max(120)(alvo, prop);
};

class MaquininhaDto {
  @IsString() @MinLength(2) @MaxLength(40) nome!: string;
  @IsOptional() @IsString() @MaxLength(30) adquirente?: string;
  @IsOptional() @IsUUID() contaBancariaId?: string | null;
  @TAXA() taxaDebito?: number | null;
  @TAXA() taxaCredito?: number | null;
  @TAXA() taxaCredito2a6?: number | null;
  @TAXA() taxaCredito7a12?: number | null;
  @TAXA() taxaPix?: number | null;
  @PRAZO() prazoDebito?: number;
  @PRAZO() prazoCredito?: number;
  @PRAZO() prazoPix?: number;
  @IsOptional() @IsBoolean() antecipacao?: boolean;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const fmtConta = (c: Record<string, unknown>) => ({
  id: c.id, nome: c.nome, banco: c.banco, agencia: c.agencia, conta: c.conta, chavePix: c.chave_pix, cnpj: c.cnpj, ativo: c.ativo,
});
const fmtMaq = (m: Record<string, unknown>) => ({
  id: m.id, nome: m.nome, adquirente: m.adquirente, contaBancariaId: m.conta_bancaria_id, contaBancaria: m.conta_nome ?? null,
  taxaDebito: n(m.taxa_debito), taxaCredito: n(m.taxa_credito), taxaCredito2a6: n(m.taxa_credito_2a6), taxaCredito7a12: n(m.taxa_credito_7a12), taxaPix: n(m.taxa_pix),
  prazoDebito: m.prazo_debito, prazoCredito: m.prazo_credito, prazoPix: m.prazo_pix, antecipacao: m.antecipacao, ativo: m.ativo,
});

@Injectable()
export class ContasBancariasService {
  constructor(private readonly ds: DataSource) {}

  async ver(u: UsuarioToken) {
    const contas = await this.ds.query(`SELECT * FROM contas_bancarias WHERE empresa_id = $1 ORDER BY ativo DESC, nome`, [u.empresaId]);
    const maqs = await this.ds.query(
      `SELECT m.*, c.nome AS conta_nome FROM maquininhas m LEFT JOIN contas_bancarias c ON c.id = m.conta_bancaria_id
        WHERE m.empresa_id = $1 ORDER BY m.ativo DESC, m.nome`, [u.empresaId]);
    return { contas: contas.map(fmtConta), maquininhas: maqs.map(fmtMaq) };
  }

  /** nomes para a recepção escolher ao digitar o código do comprovante */
  async nomesMaquininhas(empresaId: string): Promise<string[]> {
    const l: { nome: string }[] = await this.ds.query(`SELECT nome FROM maquininhas WHERE empresa_id = $1 AND ativo ORDER BY nome`, [empresaId]);
    return l.map((x) => x.nome);
  }

  private valoresConta(dto: ContaBancariaDto) {
    return [dto.nome.trim(), dto.banco?.trim() || null, dto.agencia?.trim() || null, dto.conta?.trim() || null, dto.chavePix?.trim() || null,
      dto.cnpj?.replace(/\D/g, '') || null, dto.ativo ?? true];
  }

  async criarConta(u: UsuarioToken, dto: ContaBancariaDto) {
    const [c] = await this.ds.query(
      `INSERT INTO contas_bancarias (empresa_id, nome, banco, agencia, conta, chave_pix, cnpj, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u.empresaId, ...this.valoresConta(dto)]);
    return { ok: true, id: c.id };
  }

  async atualizarConta(u: UsuarioToken, id: string, dto: ContaBancariaDto) {
    const r = await this.ds.query(
      `UPDATE contas_bancarias SET nome=$3, banco=$4, agencia=$5, conta=$6, chave_pix=$7, cnpj=$8, ativo=$9 WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, u.empresaId, ...this.valoresConta(dto)]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Conta bancária não encontrada.');
    return { ok: true };
  }

  private async valoresMaq(u: UsuarioToken, dto: MaquininhaDto) {
    if (dto.contaBancariaId) {
      const [c] = await this.ds.query(`SELECT id FROM contas_bancarias WHERE id = $1 AND empresa_id = $2`, [dto.contaBancariaId, u.empresaId]);
      if (!c) throw new BadRequestException('Conta bancária não encontrada.');
    }
    const t = (v?: number | null) => (v === undefined || v === null ? null : v.toFixed(3));
    return [dto.nome.trim(), dto.adquirente?.trim() || null, dto.contaBancariaId ?? null, t(dto.taxaDebito), t(dto.taxaCredito), t(dto.taxaCredito2a6),
      t(dto.taxaCredito7a12), t(dto.taxaPix), dto.prazoDebito ?? 1, dto.prazoCredito ?? 30, dto.prazoPix ?? 0, dto.antecipacao ?? false, dto.ativo ?? true];
  }

  private async nomeLivre(u: UsuarioToken, nome: string, ignorar?: string) {
    const [ja] = await this.ds.query(`SELECT id FROM maquininhas WHERE empresa_id = $1 AND lower(nome) = lower($2) ${ignorar ? 'AND id <> $3' : ''}`,
      ignorar ? [u.empresaId, nome.trim(), ignorar] : [u.empresaId, nome.trim()]);
    if (ja) throw new BadRequestException(`Já existe a maquininha "${nome.trim()}".`);
  }

  async criarMaquininha(u: UsuarioToken, dto: MaquininhaDto) {
    await this.nomeLivre(u, dto.nome);
    const [m] = await this.ds.query(
      `INSERT INTO maquininhas (empresa_id, nome, adquirente, conta_bancaria_id, taxa_debito, taxa_credito, taxa_credito_2a6, taxa_credito_7a12, taxa_pix,
         prazo_debito, prazo_credito, prazo_pix, antecipacao, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [u.empresaId, ...(await this.valoresMaq(u, dto))]);
    return { ok: true, id: m.id };
  }

  async atualizarMaquininha(u: UsuarioToken, id: string, dto: MaquininhaDto) {
    await this.nomeLivre(u, dto.nome, id);
    const r = await this.ds.query(
      `UPDATE maquininhas SET nome=$3, adquirente=$4, conta_bancaria_id=$5, taxa_debito=$6, taxa_credito=$7, taxa_credito_2a6=$8, taxa_credito_7a12=$9, taxa_pix=$10,
         prazo_debito=$11, prazo_credito=$12, prazo_pix=$13, antecipacao=$14, ativo=$15 WHERE id=$1 AND empresa_id=$2 RETURNING id`,
      [id, u.empresaId, ...(await this.valoresMaq(u, dto))]);
    if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Maquininha não encontrada.');
    return { ok: true };
  }
}

@Controller('contas-bancarias')
export class ContasBancariasController {
  constructor(private readonly service: ContasBancariasService) {}

  @Get()
  @Requer('caixa.adm', 'despesas.gerenciar', 'faturamento.gerenciar')
  ver(@Usuario() u: UsuarioToken) {
    return this.service.ver(u);
  }

  @Post()
  @Requer('caixa.adm')
  criarConta(@Usuario() u: UsuarioToken, @Body() dto: ContaBancariaDto) {
    return this.service.criarConta(u, dto);
  }

  @Patch(':id')
  @Requer('caixa.adm')
  atualizarConta(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContaBancariaDto) {
    return this.service.atualizarConta(u, id, dto);
  }

  @Post('maquininhas')
  @Requer('caixa.adm')
  criarMaquininha(@Usuario() u: UsuarioToken, @Body() dto: MaquininhaDto) {
    return this.service.criarMaquininha(u, dto);
  }

  @Patch('maquininhas/:id')
  @Requer('caixa.adm')
  atualizarMaquininha(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MaquininhaDto) {
    return this.service.atualizarMaquininha(u, id, dto);
  }
}
