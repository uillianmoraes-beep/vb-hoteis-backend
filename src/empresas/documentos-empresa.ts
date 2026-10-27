import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Res, StreamableFile } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { promises as fs } from 'fs';
import { dirname, join, normalize, sep } from 'path';
import { randomUUID } from 'crypto';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Documentos obrigatórios da empresa: alvará, AVCB dos bombeiros, dedetização, PCMSO, PGR, licença sanitária…
 * Cada renovação é um novo registro (o histórico fica); vale o mais recente de cada tipo e ambiente.
 * Avisa no sino quando vence ou está perto de vencer, e lista os que faltam.
 */

export const GRUPOS_DOC_EMPRESA = {
  municipal: 'Prefeitura',
  bombeiros: 'Corpo de Bombeiros',
  registro: 'Registros federais e estaduais',
  normas: 'Normas e conformidade',
  alimentos: 'Cozinha e alimentos (Anvisa RDC 216)',
  lazer: 'Piscinas e hidromassagens',
  manutencao: 'Manutenção e saúde',
  outros: 'Outros',
} as const;
type GrupoDoc = keyof typeof GRUPOS_DOC_EMPRESA;
/** [nome, obrigatório para todos, validade típica em meses (sugestão), grupo, explicação] */
export const TIPOS_DOC_EMPRESA: Record<string, [string, boolean, number | null, GrupoDoc, string]> = {
  zoneamento: ['Consulta prévia de zoneamento / viabilidade', true, null, 'municipal', 'Confirma que o endereço permite motel ou hotel.'],
  habite_se: ['Habite-se / certificado de conclusão de obra', true, null, 'municipal', 'A obra foi feita conforme o projeto e tem uso comercial/hoteleiro.'],
  alvara: ['Alvará de localização e funcionamento', true, 12, 'municipal', 'Autorização da prefeitura para funcionar neste endereço.'],
  sanitaria: ['Licença sanitária (vigilância)', true, 12, 'municipal', 'Obrigatória por causa do enxoval, da limpeza e da comida/bebida servida.'],
  publicidade: ['Licença de publicidade (letreiro e fachada)', false, 12, 'municipal', 'No Rio e em várias cidades o letreiro e a fachada pagam licença à prefeitura. Confira a regra da sua cidade.'],
  ambiental: ['Licença ambiental', false, 48, 'municipal', 'Exigida conforme o porte, o esgoto, a lavanderia própria e o descarte de resíduos.'],
  bombeiros: ['AVCB / CLCB (Corpo de Bombeiros)', true, 36, 'bombeiros', 'Rotas de fuga, extintores, iluminação de emergência e alarme.'],
  extintores: ['Recarga e inspeção dos extintores', true, 12, 'bombeiros', 'Recarga anual e o selo do Inmetro em dia.'],
  cadastur: ['Cadastur (Ministério do Turismo)', true, 24, 'registro', 'Obrigatório para meios de hospedagem (Lei 11.771/2008); renova a cada 2 anos.'],
  cartao_cnpj: ['CNPJ e registro na Junta Comercial', true, null, 'registro', 'Cartão CNPJ e o registro na Junta Comercial do estado.'],
  contrato_social: ['Contrato social / alterações', false, null, 'registro', ''],
  inscricao_estadual: ['Inscrição estadual (se vende mercadorias)', false, null, 'registro', 'Para a nota fiscal do consumo (NFC-e).'],
  inscricao_municipal: ['Inscrição municipal (ISS)', true, null, 'registro', 'Para a nota de serviço (NFS-e) da hospedagem.'],
  cnd: ['Certidões negativas (CND)', false, 6, 'registro', ''],
  acessibilidade: ['Acessibilidade (suítes adaptadas / laudo)', true, null, 'normas', 'Percentual mínimo de suítes adaptadas para pessoas com deficiência (ABNT e leis locais).'],
  lgpd: ['LGPD: política de privacidade e sigilo', true, 12, 'normas', 'Regras de sigilo e proteção dos dados dos clientes; revisar todo ano.'],
  eca: ['ECA: procedimento contra entrada de menores', true, null, 'normas', 'Identificação na portaria e a placa de proibição de menores desacompanhados.'],
  boas_praticas: ['Manual de Boas Práticas e POPs da cozinha', true, 12, 'alimentos', 'Obrigatório (RDC 216): regras de manipulação, higiene, armazenamento e sobras. Revisar todo ano.'],
  aso_manipuladores: ['Exames médicos dos manipuladores de alimentos', true, 12, 'alimentos', 'Atestado de saúde (ASO/PCMSO) de quem trabalha na cozinha. Os de cada funcionário ficam em RH › Documentos.'],
  armazenamento: ['Armazenamento e temperatura dos alimentos', true, null, 'alimentos', 'Separação por temperatura, controle de validade e sem reaproveitar sobras. O registro diário fica em Temperaturas.'],
  piso_antiderrapante: ['Piso antiderrapante nas piscinas e hidros', false, null, 'lazer', 'O piso em volta da piscina e da hidromassagem precisa ser antiderrapante (foto ou laudo).'],
  dedetizacao: ['Dedetização e desratização', true, 6, 'manutencao', 'Certificado da empresa controladora de pragas.'],
  caixa_agua: ["Limpeza da caixa d'água", true, 6, 'manutencao', ''],
  pcmso: ['PCMSO (saúde ocupacional)', true, 12, 'manutencao', ''],
  pgr: ['PGR (riscos ocupacionais)', true, 24, 'manutencao', ''],
  pmoc: ['PMOC (ar-condicionado)', false, 12, 'manutencao', ''],
  piscina: ['Análise da água da piscina (laboratório)', false, 1, 'lazer', 'O cloro e o pH do dia a dia ficam em Piscinas e hidros.'],
  ecad: ['ECAD (música ambiente)', false, 12, 'outros', ''],
  seguro: ['Seguro do imóvel', false, 12, 'outros', ''],
  outro: ['Outro', false, null, 'outros', ''],
};
const TIPOS_ARQUIVO: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_BYTES = 8_000_000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

class DocEmpresaDto {
  @IsIn(Object.keys(TIPOS_DOC_EMPRESA)) tipo!: string;
  @IsOptional() @IsUUID() ambienteId?: string;
  @IsOptional() @IsString() @MaxLength(150) descricao?: string;
  @IsOptional() @IsString() @MaxLength(60) numero?: string;
  @IsOptional() @Matches(DATA) emissao?: string;
  @IsOptional() @Matches(DATA) validade?: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) avisarDias?: number;
  @IsOptional() @IsString() @MaxLength(120) responsavel?: string;
  @IsOptional() @IsString() @MaxLength(160) nomeArquivo?: string;
  /** data:application/pdf;base64,… (ou foto) — opcional: dá para registrar só a validade */
  @IsOptional() @IsString() @MaxLength(11_000_000) arquivo?: string;
}

class DispensadosDto {
  @IsArray() @ArrayMaxSize(50) @IsIn(Object.keys(TIPOS_DOC_EMPRESA), { each: true }) tipos!: string[];
}

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dia = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

@Injectable()
export class DocumentosEmpresaService {
  constructor(private readonly ds: DataSource) {}

  private pasta() {
    const p = (process.env.VB_FOTOS_DIR || '').trim();
    if (!p) throw new BadRequestException('A pasta de arquivos não está configurada neste servidor (VB_FOTOS_DIR). Fale com a Virtual Barra.');
    return p;
  }
  private caminho(relativo: string) {
    const base = normalize(this.pasta());
    const abs = normalize(join(base, relativo));
    if (!abs.startsWith(base.endsWith(sep) ? base : base + sep)) throw new NotFoundException('Documento não encontrado.');
    return abs;
  }

  /** situação de cada documento: em dia, vencendo, vencido; e o que falta */
  async listar(u: UsuarioToken) {
    const hoje = hojeSP();
    const [emp] = await this.ds.query(`SELECT documentos_dispensados FROM empresas WHERE id = $1`, [u.empresaId]);
    const dispensados: string[] = emp?.documentos_dispensados ?? [];
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT d.*, a.nome AS ambiente FROM empresa_documentos d LEFT JOIN ambientes a ON a.id = d.ambiente_id
        WHERE d.empresa_id = $1 ORDER BY d.tipo, d.criado_em DESC`, [u.empresaId]);
    const vistos = new Set<string>();
    const docs = l.map((d) => {
      const validade = dia(d.validade);
      const chave = `${d.tipo}:${d.ambiente_id ?? ''}`;
      const atual = !vistos.has(chave);
      vistos.add(chave);
      const faltam = validade ? diasEntre(hoje, validade) : null;
      const situacao = !validade ? 'sem_validade' : faltam! < 0 ? 'vencido' : faltam! <= Number(d.avisar_dias) ? 'vencendo' : 'em_dia';
      return {
        id: d.id, tipo: d.tipo, tipoNome: TIPOS_DOC_EMPRESA[d.tipo as string]?.[0] ?? d.tipo, ambienteId: d.ambiente_id, ambiente: d.ambiente,
        descricao: d.descricao, numero: d.numero, emissao: dia(d.emissao), validade, avisarDias: Number(d.avisar_dias), responsavel: d.responsavel,
        temArquivo: !!d.arquivo, nomeArquivo: d.nome_arquivo, enviadoPor: d.enviado_por, criadoEm: d.criado_em, atual, situacao, faltamDias: faltam,
      };
    });
    const atuais = docs.filter((d) => d.atual);
    const faltando = Object.entries(TIPOS_DOC_EMPRESA)
      .filter(([k, [, obrig]]) => obrig && !dispensados.includes(k) && !atuais.some((d) => d.tipo === k))
      .map(([k, [nome, , , grupo]]) => ({ tipo: k, nome, grupo }));
    return {
      tipos: Object.fromEntries(Object.entries(TIPOS_DOC_EMPRESA).map(([k, [nome, obrig, meses, grupo, ajuda]]) => [k, { nome, obrigatorio: obrig, meses, grupo, ajuda }])),
      grupos: GRUPOS_DOC_EMPRESA,
      dispensados,
      documentos: docs,
      faltando,
      resumo: {
        emDia: atuais.filter((d) => d.situacao === 'em_dia' || d.situacao === 'sem_validade').length,
        vencendo: atuais.filter((d) => d.situacao === 'vencendo').length,
        vencidos: atuais.filter((d) => d.situacao === 'vencido').length,
        faltando: faltando.length,
      },
    };
  }

  async salvar(u: UsuarioToken, dto: DocEmpresaDto) {
    if (dto.ambienteId) {
      const [a] = await this.ds.query(`SELECT id FROM ambientes WHERE id = $1 AND empresa_id = $2`, [dto.ambienteId, u.empresaId]);
      if (!a) throw new BadRequestException('Ambiente não encontrado.');
    }
    if (dto.emissao && dto.validade && dto.validade < dto.emissao) throw new BadRequestException('A validade não pode ser antes da emissão.');
    const id = randomUUID();
    let rel: string | null = null, mime: string | null = null, bytes: number | null = null;
    if (dto.arquivo) {
      const m = /^data:([a-z/]+);base64,/.exec(dto.arquivo);
      const ext = m ? TIPOS_ARQUIVO[m[1]] : undefined;
      if (!m || !ext) throw new BadRequestException('Envie o documento em PDF (ou uma foto JPG/PNG).');
      const bin = Buffer.from(dto.arquivo.slice(m[0].length), 'base64');
      if (!bin.length) throw new BadRequestException('O arquivo está vazio.');
      if (bin.length > MAX_BYTES) throw new BadRequestException('Arquivo grande demais (máximo 8 MB).');
      if (ext === 'pdf' && bin.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('Esse arquivo não é um PDF de verdade.');
      rel = join(u.empresaId, 'empresa', `${id}.${ext}`);
      await fs.mkdir(dirname(this.caminho(rel)), { recursive: true });
      await fs.writeFile(this.caminho(rel), bin);
      mime = m[1]; bytes = bin.length;
    }
    await this.ds.query(
      `INSERT INTO empresa_documentos (id, empresa_id, ambiente_id, tipo, descricao, numero, emissao, validade, avisar_dias, responsavel, nome_arquivo, mime, arquivo, bytes, enviado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, u.empresaId, dto.ambienteId ?? null, dto.tipo, dto.descricao?.trim() || null, dto.numero?.trim() || null, dto.emissao || null, dto.validade || null,
        dto.avisarDias ?? 30, dto.responsavel?.trim() || null, rel ? (dto.nomeArquivo?.trim() || `documento.${rel.split('.').pop()}`).slice(0, 160) : null, mime, rel, bytes, u.nome]);
    return { ok: true, id };
  }

  async dispensar(u: UsuarioToken, dto: DispensadosDto) {
    await this.ds.query(`UPDATE empresas SET documentos_dispensados = $2::jsonb WHERE id = $1`, [u.empresaId, JSON.stringify([...new Set(dto.tipos)])]);
    return { ok: true };
  }

  async ler(u: UsuarioToken, id: string) {
    const [d] = await this.ds.query(`SELECT arquivo, mime, nome_arquivo FROM empresa_documentos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!d?.arquivo) throw new NotFoundException('Este registro não tem arquivo.');
    try {
      return { bin: await fs.readFile(this.caminho(d.arquivo)), mime: d.mime as string, nome: d.nome_arquivo as string };
    } catch {
      throw new NotFoundException('O arquivo não está mais na pasta do servidor.');
    }
  }

  async apagar(u: UsuarioToken, id: string) {
    const [d] = await this.ds.query(`SELECT arquivo FROM empresa_documentos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!d) throw new NotFoundException('Documento não encontrado.');
    await this.ds.query(`DELETE FROM empresa_documentos WHERE id = $1`, [id]);
    if (d.arquivo) await fs.rm(this.caminho(d.arquivo), { force: true }).catch(() => undefined);
    return { ok: true };
  }
}

@Controller('empresa-documentos')
export class DocumentosEmpresaController {
  constructor(private readonly service: DocumentosEmpresaService) {}

  @Get()
  @Requer('empresa.editar', 'caixa.adm', 'relatorios.ver')
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u);
  }

  @Post()
  @Requer('empresa.editar', 'caixa.adm')
  salvar(@Usuario() u: UsuarioToken, @Body() dto: DocEmpresaDto) {
    return this.service.salvar(u, dto);
  }

  /** tipos que este estabelecimento não precisa */
  @Put('dispensados')
  @Requer('empresa.editar', 'caixa.adm')
  dispensar(@Usuario() u: UsuarioToken, @Body() dto: DispensadosDto) {
    return this.service.dispensar(u, dto);
  }

  @Get(':id/arquivo')
  @Requer('empresa.editar', 'caixa.adm', 'relatorios.ver')
  async abrir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void }) {
    const a = await this.service.ler(u, id);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    return new StreamableFile(a.bin);
  }

  @Delete(':id')
  @Requer('empresa.editar', 'caixa.adm')
  apagar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagar(u, id);
  }
}
