import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Ponto de CONTROLE INTERNO (não é o ponto oficial REP-P da Portaria 671; a folha continua com o contador).
 * O rosto vira uma "impressão facial" de 128 números no próprio navegador; aqui só se comparam os números
 * (distância menor que 0,45 = mesma pessoa). Cada batida guarda a foto (para conferência) e a localização.
 * Biometria é dado sensível (LGPD): só cadastra com o consentimento do funcionário registrado.
 */

const LIMITE_OK = 0.45;    // igual
const LIMITE_DUVIDA = 0.55; // entre 0,45 e 0,55: grava, mas marca para o RH conferir
const TIPOS_FOTO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

class RostoDto {
  @IsArray() @ArrayMinSize(128) @ArrayMaxSize(128) @IsNumber({}, { each: true }) descritor!: number[];
  @IsString() @MaxLength(700_000) foto!: string;
  @IsBoolean() consentimento!: boolean;
}
class BatidaDto {
  @IsArray() @ArrayMinSize(128) @ArrayMaxSize(128) @IsNumber({}, { each: true }) descritor!: number[];
  @IsString() @MaxLength(700_000) foto!: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) precisao?: number;
}
class QuiosqueDto extends BatidaDto {
  @IsUUID() funcionarioId!: string;
}
class AjusteDto {
  @IsUUID() funcionarioId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) momento!: string;
  @IsString() @MinLength(5) @MaxLength(300) motivo!: string;
}
class AnularDto {
  @IsString() @MinLength(5) @MaxLength(300) motivo!: string;
}
class LocalDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number | null;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number | null;
  @IsOptional() @IsInt() @Min(20) @Max(5000) raio?: number;
}

/** distância em metros entre dois pontos (fórmula de haversine) */
function metros(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const distancia = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

@Injectable()
export class PontoService {
  constructor(private readonly ds: DataSource) {}

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR).');
    return p;
  }
  private caminho(rel: string) {
    const base = normalize(this.pasta());
    const abs = normalize(join(base, rel));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Arquivo não encontrado.');
    return abs;
  }
  private async gravarFoto(empresaId: string, pasta: string, dataUrl: string) {
    const m = /^data:([a-z/]+);base64,/.exec(dataUrl);
    const ext = m ? TIPOS_FOTO[m[1]] : undefined;
    if (!m || !ext) throw new BadRequestException('A foto precisa ser JPG, PNG ou WebP.');
    const bin = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    if (bin.length < 2000 || bin.length > 500_000) throw new BadRequestException('Foto inválida.');
    const rel = join(empresaId, pasta, `${randomUUID()}.${ext}`);
    await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
    await fs.writeFile(this.caminho(rel), bin);
    return rel;
  }

  private async funcionario(empresaId: string, id: string) {
    const [f] = await this.ds.query(`SELECT id, nome, funcao, ativo, rosto_descritor, ponto_token FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [id, empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    return f as { id: string; nome: string; funcao: string; ativo: boolean; rosto_descritor: number[] | null; ponto_token: string | null };
  }

  /* -------------------------------------------------- cadastro (RH) */

  async cadastrarRosto(u: UsuarioToken, funcionarioId: string, dto: RostoDto) {
    if (!dto.consentimento) throw new BadRequestException('Sem o consentimento do funcionário (LGPD) não dá para cadastrar o rosto.');
    await this.funcionario(u.empresaId, funcionarioId);
    const foto = await this.gravarFoto(u.empresaId, 'rostos', dto.foto);
    await this.ds.query(
      `UPDATE funcionarios SET rosto_descritor = $3::jsonb, rosto_foto = $4, rosto_consentimento_em = now(), rosto_consentimento_por = $5 WHERE id = $1 AND empresa_id = $2`,
      [funcionarioId, u.empresaId, JSON.stringify(dto.descritor.map(r4)), foto, u.nome]);
    return { ok: true };
  }

  async apagarRosto(u: UsuarioToken, funcionarioId: string) {
    await this.ds.query(`UPDATE funcionarios SET rosto_descritor = NULL, rosto_foto = NULL, rosto_consentimento_em = NULL, rosto_consentimento_por = NULL WHERE id = $1 AND empresa_id = $2`, [funcionarioId, u.empresaId]);
    return { ok: true };
  }

  /** link pessoal do celular (troca o código se pedir de novo) */
  async gerarLink(u: UsuarioToken, funcionarioId: string) {
    await this.funcionario(u.empresaId, funcionarioId);
    const token = randomBytes(18).toString('base64url');
    await this.ds.query(`UPDATE funcionarios SET ponto_token = $3 WHERE id = $1 AND empresa_id = $2`, [funcionarioId, u.empresaId, token]);
    return { token, caminho: `/meu-ponto/${token}` };
  }

  async salvarLocal(u: UsuarioToken, ambienteId: string, dto: LocalDto) {
    const [linhas] = await this.ds.query(`UPDATE ambientes SET ponto_lat = $3, ponto_lng = $4, ponto_raio = COALESCE($5, ponto_raio) WHERE id = $1 AND empresa_id = $2 RETURNING id`,
      [ambienteId, u.empresaId, dto.lat ?? null, dto.lng ?? null, dto.raio ?? null]);
    if (!linhas?.length) throw new NotFoundException('Ambiente não encontrado.');
    return this.painel(u);
  }

  /* -------------------------------------------------------- batida */

  private async bater(empresaId: string, funcionarioId: string, dto: BatidaDto, origem: 'tablet' | 'celular', quem: string) {
    const f = await this.funcionario(empresaId, funcionarioId);
    if (!f.ativo) throw new ForbiddenException('Funcionário inativo.');
    if (!f.rosto_descritor?.length) throw new BadRequestException('Seu rosto ainda não foi cadastrado. Peça ao RH.');
    const d = r4(distancia(dto.descritor, f.rosto_descritor));
    if (d > LIMITE_DUVIDA) throw new BadRequestException('O rosto não confere. Fique de frente para a câmera, com boa luz, e tente de novo.');
    // anti-repetição: a mesma pessoa não bate duas vezes em 2 minutos
    const [rec] = await this.ds.query(`SELECT 1 FROM ponto_registros WHERE funcionario_id = $1 AND NOT anulado AND momento > now() - interval '2 minutes'`, [funcionarioId]);
    if (rec) throw new BadRequestException('Você acabou de bater o ponto. Espere 2 minutos para bater de novo.');
    // local: o mais perto dos locais configurados
    let distLocal: number | null = null, localOk: boolean | null = null, ambienteId: string | null = null;
    if (dto.lat !== undefined && dto.lng !== undefined) {
      const locais: { id: string; lat: string; lng: string; raio: number }[] = await this.ds.query(
        `SELECT id, ponto_lat AS lat, ponto_lng AS lng, ponto_raio AS raio FROM ambientes WHERE empresa_id = $1 AND ponto_lat IS NOT NULL AND ponto_lng IS NOT NULL`, [empresaId]);
      for (const l of locais) {
        const m = metros({ lat: dto.lat, lng: dto.lng }, { lat: Number(l.lat), lng: Number(l.lng) });
        if (distLocal === null || m < distLocal) { distLocal = m; ambienteId = l.id; localOk = m <= Number(l.raio) + Math.min(Number(dto.precisao ?? 0), 100); }
      }
    }
    const foto = await this.gravarFoto(empresaId, 'ponto', dto.foto);
    await this.ds.query(
      `INSERT INTO ponto_registros (empresa_id, funcionario_id, origem, foto, distancia_rosto, rosto_ok, lat, lng, precisao_m, distancia_local_m, local_ok, ambiente_id, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [empresaId, funcionarioId, origem, foto, d, d <= LIMITE_OK, dto.lat ?? null, dto.lng ?? null, dto.precisao !== undefined ? Math.round(dto.precisao) : null, distLocal, localOk, ambienteId, quem]);
    const hoje = await this.batidasDoDia(empresaId, funcionarioId, hojeSP());
    const n = hoje.length;
    return {
      nome: f.nome, tipo: n % 2 === 1 ? 'Entrada' : 'Saída', hora: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }),
      rostoOk: d <= LIMITE_OK, localOk, distanciaLocal: distLocal, batidasHoje: hoje,
    };
  }

  private async batidasDoDia(empresaId: string, funcionarioId: string, dia: string) {
    const l: { momento: string }[] = await this.ds.query(
      `SELECT momento FROM ponto_registros WHERE empresa_id = $1 AND funcionario_id = $2 AND NOT anulado AND (momento AT TIME ZONE 'America/Sao_Paulo')::date = $3::date ORDER BY momento`,
      [empresaId, funcionarioId, dia]);
    return l.map((x, i) => ({ tipo: i % 2 === 0 ? 'Entrada' : 'Saída', hora: new Date(x.momento).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) }));
  }

  /** tablet do ponto (logado): lista de quem tem rosto cadastrado */
  async quiosque(u: UsuarioToken) {
    const l = await this.ds.query(
      `SELECT id, nome, funcao, (rosto_descritor IS NOT NULL) AS tem_rosto FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]);
    return l.map((f: Record<string, unknown>) => ({ id: f.id, nome: f.nome, funcao: f.funcao, temRosto: f.tem_rosto }));
  }
  async baterQuiosque(u: UsuarioToken, dto: QuiosqueDto) {
    return this.bater(u.empresaId, dto.funcionarioId, dto, 'tablet', `Tablet (${u.nome})`);
  }
  /** rosto de referência do funcionário escolhido no tablet (para comparar na hora) */
  async descritor(u: UsuarioToken, funcionarioId: string) {
    const f = await this.funcionario(u.empresaId, funcionarioId);
    return { temRosto: !!f.rosto_descritor };
  }

  /* -------------------------------------------- link do celular (público) */

  private async porToken(token: string) {
    if (!/^[\w-]{20,40}$/.test(token)) throw new NotFoundException('Link inválido.');
    const [f] = await this.ds.query(
      `SELECT f.id, f.empresa_id, f.nome, f.ativo, (f.rosto_descritor IS NOT NULL) AS tem_rosto, e.nome AS empresa FROM funcionarios f JOIN empresas e ON e.id = f.empresa_id WHERE f.ponto_token = $1`, [token]);
    if (!f || !f.ativo) throw new NotFoundException('Link inválido ou desativado. Peça um novo ao RH.');
    return f as { id: string; empresa_id: string; nome: string; tem_rosto: boolean; empresa: string };
  }
  async meuPonto(token: string) {
    const f = await this.porToken(token);
    const [loc] = await this.ds.query(`SELECT count(*)::int AS n FROM ambientes WHERE empresa_id = $1 AND ponto_lat IS NOT NULL`, [f.empresa_id]);
    return { nome: f.nome, empresa: f.empresa, temRosto: f.tem_rosto, pedeLocal: Number(loc?.n) > 0, batidasHoje: await this.batidasDoDia(f.empresa_id, f.id, hojeSP()) };
  }
  async baterCelular(token: string, dto: BatidaDto) {
    const f = await this.porToken(token);
    const [loc] = await this.ds.query(`SELECT count(*)::int AS n FROM ambientes WHERE empresa_id = $1 AND ponto_lat IS NOT NULL`, [f.empresa_id]);
    if (Number(loc?.n) > 0 && (dto.lat === undefined || dto.lng === undefined)) throw new BadRequestException('Ligue a localização do celular para bater o ponto.');
    return this.bater(f.empresa_id, f.id, dto, 'celular', 'Celular');
  }

  /* ---------------------------------------------------------- RH */

  async painel(u: UsuarioToken, diaQ?: string) {
    const dia = diaQ && /^\d{4}-\d{2}-\d{2}$/.test(diaQ) ? diaQ : hojeSP();
    const funcs: Record<string, unknown>[] = await this.ds.query(
      `SELECT f.id, f.nome, f.funcao, (f.rosto_descritor IS NOT NULL) AS tem_rosto, f.rosto_consentimento_em, (f.ponto_token IS NOT NULL) AS tem_link, f.telefone,
              e.inicio AS esc_inicio, e.fim AS esc_fim, e.tipo AS esc_tipo
         FROM funcionarios f LEFT JOIN escala_dias e ON e.funcionario_id = f.id AND e.data = $2::date
        WHERE f.empresa_id = $1 AND f.ativo ORDER BY f.nome`, [u.empresaId, dia]);
    const regs: Record<string, unknown>[] = await this.ds.query(
      `SELECT id, funcionario_id, momento, origem, rosto_ok, distancia_rosto, local_ok, distancia_local_m, observacao, anulado, anulado_motivo, registrado_por, (foto IS NOT NULL) AS tem_foto
         FROM ponto_registros WHERE empresa_id = $1 AND (momento AT TIME ZONE 'America/Sao_Paulo')::date = $2::date ORDER BY momento`, [u.empresaId, dia]);
    const ambientes: Record<string, unknown>[] = await this.ds.query(`SELECT id, nome, ponto_lat, ponto_lng, ponto_raio FROM ambientes WHERE empresa_id = $1 ORDER BY nome`, [u.empresaId]);
    const hm = (iso: unknown) => new Date(String(iso)).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const lista = funcs.map((f) => {
      const dele = regs.filter((r) => r.funcionario_id === f.id);
      const validas = dele.filter((r) => !r.anulado);
      const primeira = validas[0] ? hm(validas[0].momento) : null;
      const atraso = primeira && f.esc_tipo === 'trabalho' && f.esc_inicio ? Math.max(0, minutos(primeira) - minutos(String(f.esc_inicio))) : 0;
      return {
        id: f.id, nome: f.nome, funcao: f.funcao, temRosto: f.tem_rosto, consentimentoEm: f.rosto_consentimento_em, temLink: f.tem_link, telefone: f.telefone,
        escala: f.esc_tipo ? (f.esc_tipo === 'trabalho' ? `${f.esc_inicio ?? ''}–${f.esc_fim ?? ''}` : String(f.esc_tipo)) : null,
        batidas: dele.map((r) => ({
          id: r.id, hora: hm(r.momento), origem: r.origem, rostoOk: r.rosto_ok, localOk: r.local_ok, distanciaLocal: r.distancia_local_m, observacao: r.observacao,
          anulado: r.anulado, anuladoMotivo: r.anulado_motivo, registradoPor: r.registrado_por, temFoto: r.tem_foto,
        })),
        atrasoMin: atraso > 5 ? atraso : 0,
        alertas: validas.filter((r) => r.rosto_ok === false || r.local_ok === false).length,
        semBatida: f.esc_tipo === 'trabalho' && !validas.length,
      };
    });
    return {
      dia, funcionarios: lista,
      ambientes: ambientes.map((a) => ({ id: a.id, nome: a.nome, lat: a.ponto_lat === null ? null : Number(a.ponto_lat), lng: a.ponto_lng === null ? null : Number(a.ponto_lng), raio: Number(a.ponto_raio) })),
      resumo: {
        comRosto: lista.filter((f) => f.temRosto).length, total: lista.length,
        bateram: lista.filter((f) => f.batidas.some((b) => !b.anulado)).length,
        alertas: lista.reduce((s, f) => s + f.alertas, 0), atrasos: lista.filter((f) => f.atrasoMin).length, semBatida: lista.filter((f) => f.semBatida).length,
      },
    };
  }

  /** batida esquecida, lançada pelo RH com o motivo */
  async ajustar(u: UsuarioToken, dto: AjusteDto) {
    await this.funcionario(u.empresaId, dto.funcionarioId);
    await this.ds.query(
      `INSERT INTO ponto_registros (empresa_id, funcionario_id, momento, origem, observacao, registrado_por) VALUES ($1,$2,($3::timestamp AT TIME ZONE 'America/Sao_Paulo'),'ajuste',$4,$5)`,
      [u.empresaId, dto.funcionarioId, dto.momento.replace('T', ' '), dto.motivo.trim(), u.nome]);
    return this.painel(u, dto.momento.slice(0, 10));
  }

  async anular(u: UsuarioToken, id: string, dto: AnularDto) {
    const [linhas] = await this.ds.query(`UPDATE ponto_registros SET anulado = true, anulado_motivo = $3 WHERE id = $1 AND empresa_id = $2 RETURNING id`, [id, u.empresaId, `${dto.motivo.trim()} (${u.nome})`]);
    if (!linhas?.length) throw new NotFoundException('Batida não encontrada.');
    return { ok: true };
  }

  async foto(u: UsuarioToken, tipo: 'batida' | 'rosto', id: string) {
    const [r] = tipo === 'batida'
      ? await this.ds.query(`SELECT foto FROM ponto_registros WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId])
      : await this.ds.query(`SELECT rosto_foto AS foto FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!r?.foto) throw new NotFoundException('Sem foto.');
    try { return { bin: await fs.readFile(this.caminho(r.foto)), mime: r.foto.endsWith('.png') ? 'image/png' : r.foto.endsWith('.webp') ? 'image/webp' : 'image/jpeg' }; }
    catch { throw new NotFoundException('A foto não está mais na pasta do servidor.'); }
  }

  /** espelho do mês de um funcionário: batidas, horas trabalhadas e a escala de cada dia */
  async espelho(u: UsuarioToken, funcionarioId: string, mesQ?: string) {
    const f = await this.funcionario(u.empresaId, funcionarioId);
    const mes = mesQ && /^\d{4}-\d{2}$/.test(mesQ) ? mesQ : hojeSP().slice(0, 7);
    const regs: { momento: string; origem: string; rosto_ok: boolean | null; local_ok: boolean | null; observacao: string | null }[] = await this.ds.query(
      `SELECT momento, origem, rosto_ok, local_ok, observacao FROM ponto_registros WHERE empresa_id = $1 AND funcionario_id = $2 AND NOT anulado
          AND to_char(momento AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $3 ORDER BY momento`, [u.empresaId, funcionarioId, mes]);
    const escala: { data: string; tipo: string; inicio: string | null; fim: string | null; intervalo_min: number }[] = await this.ds.query(
      `SELECT to_char(data, 'YYYY-MM-DD') AS data, tipo, inicio, fim, intervalo_min FROM escala_dias WHERE funcionario_id = $1 AND to_char(data, 'YYYY-MM') = $2`, [funcionarioId, mes]);
    const [ano, m] = mes.split('-').map(Number);
    const nDias = new Date(ano, m, 0).getDate();
    const dias = Array.from({ length: nDias }, (_, i) => {
      const data = `${mes}-${String(i + 1).padStart(2, '0')}`;
      const doDia = regs.filter((r) => new Date(r.momento).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) === data);
      const horas = doDia.map((r) => new Date(r.momento).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }));
      let trabalhado = 0;
      for (let k = 0; k + 1 < doDia.length; k += 2) trabalhado += (new Date(doDia[k + 1].momento).getTime() - new Date(doDia[k].momento).getTime()) / 60000;
      const e = escala.find((x) => x.data === data);
      const previsto = e?.tipo === 'trabalho' && e.inicio && e.fim ? ((minutos(e.fim) - minutos(e.inicio) + 1440) % 1440 || 1440) - (e.intervalo_min ?? 0) : 0;
      return {
        data, horas, trabalhadoMin: Math.round(trabalhado), previstoMin: previsto, saldoMin: doDia.length >= 2 ? Math.round(trabalhado) - previsto : 0,
        escala: e ? (e.tipo === 'trabalho' ? `${e.inicio ?? ''}–${e.fim ?? ''}` : e.tipo) : null,
        impar: doDia.length % 2 === 1, ajustes: doDia.filter((r) => r.origem === 'ajuste').length, alertas: doDia.filter((r) => r.rosto_ok === false || r.local_ok === false).length,
      };
    });
    const [emp] = await this.ds.query(`SELECT nome, cnpj FROM empresas WHERE id = $1`, [u.empresaId]);
    return {
      mes, funcionario: { id: f.id, nome: f.nome, funcao: f.funcao }, empresa: emp?.nome ?? '', cnpj: emp?.cnpj ?? null, dias,
      totais: { trabalhadoMin: dias.reduce((s, d) => s + d.trabalhadoMin, 0), previstoMin: dias.reduce((s, d) => s + d.previstoMin, 0), saldoMin: dias.reduce((s, d) => s + d.saldoMin, 0), diasImpar: dias.filter((d) => d.impar).length },
    };
  }
}

@Controller()
export class PontoController {
  constructor(private readonly service: PontoService) {}

  /* tablet do ponto */
  @Get('ponto/quiosque') @Requer('ponto.registrar', 'funcionarios.gerenciar')
  quiosque(@Usuario() u: UsuarioToken) { return this.service.quiosque(u); }

  @Post('ponto/quiosque') @HttpCode(200) @Requer('ponto.registrar', 'funcionarios.gerenciar')
  baterQuiosque(@Usuario() u: UsuarioToken, @Body() dto: QuiosqueDto) { return this.service.baterQuiosque(u, dto); }

  /* link do celular */
  @Publico() @Get('publico/ponto/:token')
  meuPonto(@Param('token') token: string) { return this.service.meuPonto(token); }

  @Publico() @Post('publico/ponto/:token') @HttpCode(200)
  baterCelular(@Param('token') token: string, @Body() dto: BatidaDto) { return this.service.baterCelular(token, dto); }

  /* RH */
  @Get('ponto') @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  painel(@Usuario() u: UsuarioToken, @Query('dia') dia?: string) { return this.service.painel(u, dia); }

  @Put('ponto/rosto/:funcionarioId') @Requer('funcionarios.gerenciar')
  rosto(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string, @Body() dto: RostoDto) { return this.service.cadastrarRosto(u, id, dto); }

  @Post('ponto/rosto/:funcionarioId/apagar') @HttpCode(200) @Requer('funcionarios.gerenciar')
  apagarRosto(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string) { return this.service.apagarRosto(u, id); }

  @Post('ponto/link/:funcionarioId') @HttpCode(200) @Requer('funcionarios.gerenciar')
  link(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string) { return this.service.gerarLink(u, id); }

  @Put('ponto/local/:ambienteId') @Requer('funcionarios.gerenciar', 'empresa.editar')
  local(@Usuario() u: UsuarioToken, @Param('ambienteId', ParseUUIDPipe) id: string, @Body() dto: LocalDto) { return this.service.salvarLocal(u, id, dto); }

  @Post('ponto/ajuste') @Requer('funcionarios.gerenciar')
  ajustar(@Usuario() u: UsuarioToken, @Body() dto: AjusteDto) { return this.service.ajustar(u, dto); }

  @Post('ponto/registros/:id/anular') @HttpCode(200) @Requer('funcionarios.gerenciar')
  anular(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnularDto) { return this.service.anular(u, id, dto); }

  @Get('ponto/espelho/:funcionarioId') @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  espelho(@Usuario() u: UsuarioToken, @Param('funcionarioId', ParseUUIDPipe) id: string, @Query('mes') mes?: string) { return this.service.espelho(u, id, mes); }

  @Get('ponto/foto/:tipo/:id') @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  async foto(@Usuario() u: UsuarioToken, @Param('tipo') tipo: string, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    if (tipo !== 'batida' && tipo !== 'rosto') throw new NotFoundException();
    const f = await this.service.foto(u, tipo, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(f.bin);
  }
}
