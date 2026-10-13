import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { CriarFichaDto, DadosFichaDto, SalvarFichaDto } from './fichas.dto';
import { UsuarioToken } from '../common/permissoes';

const OBRIGATORIOS: (keyof DadosFichaDto)[] = ['nome', 'nacionalidade', 'telefone', 'nascimento', 'documento', 'tipoDocumento'];
const limpa = (d: DadosFichaDto = {}) => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) o[k] = typeof v === 'string' ? v.trim() : v;
  if (typeof o.cpf === 'string') o.cpf = (o.cpf as string).replace(/\D/g, '');
  if (typeof o.placa === 'string') o.placa = (o.placa as string).toUpperCase();
  return o;
};
const imgOk = (s?: string) => !s || /^data:image\/(jpeg|png|webp);base64,/.test(s);

@Injectable()
export class FichasService {
  constructor(private readonly ds: DataSource) {}

  private formatar(f: Record<string, unknown>, completo = false) {
    return {
      id: f.id, estadiaId: f.estadia_id, unidadeId: f.unidade_id, token: f.token, status: f.status, dados: f.dados,
      lgpdAceitoEm: f.lgpd_aceito_em, preenchidaPor: f.preenchida_por, preenchidaEm: f.preenchida_em, criadoEm: f.criado_em,
      temDocFoto: !!f.doc_foto, temAssinatura: !!f.assinatura,
      ...(completo ? { docFoto: f.doc_foto, assinatura: f.assinatura } : {}),
    };
  }

  async criar(u: UsuarioToken, dto: CriarFichaDto) {
    let unidadeId = dto.unidadeId ?? null;
    if (dto.estadiaId) {
      const [e] = await this.ds.query(`SELECT id, unidade_id FROM estadias WHERE id = $1 AND empresa_id = $2`, [dto.estadiaId, u.empresaId]);
      if (!e) throw new NotFoundException('Hospedagem não encontrada.');
      unidadeId = e.unidade_id;
    } else if (unidadeId) {
      const [un] = await this.ds.query(`SELECT id FROM unidades WHERE id = $1 AND empresa_id = $2`, [unidadeId, u.empresaId]);
      if (!un) throw new NotFoundException('Quarto não encontrado.');
    }
    const token = randomBytes(9).toString('base64url');
    const [f] = await this.ds.query(
      `INSERT INTO fichas_hospede (empresa_id, estadia_id, unidade_id, token, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [u.empresaId, dto.estadiaId ?? null, unidadeId, token, u.nome]);
    return this.formatar(Array.isArray(f) ? f[0] : f);
  }

  async listar(u: UsuarioToken, filtro: { estadiaId?: string; unidadeId?: string; busca?: string }) {
    const params: unknown[] = [u.empresaId];
    let where = 'empresa_id = $1';
    if (filtro.estadiaId) { params.push(filtro.estadiaId); where += ` AND estadia_id = $${params.length}`; }
    // quarto sem conta aberta: fichas recentes (últimos 3 dias) daquele quarto
    if (filtro.unidadeId) { params.push(filtro.unidadeId); where += ` AND unidade_id = $${params.length} AND criado_em >= now() - interval '3 days'`; }
    if (filtro.busca) { params.push(`%${filtro.busca.toLowerCase()}%`); where += ` AND (lower(dados->>'nome') LIKE $${params.length} OR dados->>'cpf' LIKE $${params.length} OR lower(dados->>'documento') LIKE $${params.length})`; }
    const l = await this.ds.query(`SELECT * FROM fichas_hospede WHERE ${where} ORDER BY criado_em DESC LIMIT 300`, params);
    return l.map((f: Record<string, unknown>) => this.formatar(f));
  }

  async uma(u: UsuarioToken, id: string) {
    const [f] = await this.ds.query(`SELECT * FROM fichas_hospede WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!f) throw new NotFoundException('Ficha não encontrada.');
    const [emp] = await this.ds.query(`SELECT nome FROM empresas WHERE id = $1`, [u.empresaId]);
    const [un] = f.unidade_id ? await this.ds.query(`SELECT codigo FROM unidades WHERE id = $1`, [f.unidade_id]) : [null];
    return { ...this.formatar(f, true), empresa: emp?.nome ?? '', unidade: un?.codigo ?? null };
  }

  private async gravar(where: string, params: unknown[], dto: SalvarFichaDto, quem: 'recepcao' | 'hospede') {
    if (!imgOk(dto.docFoto) || !imgOk(dto.assinatura)) throw new BadRequestException('Imagem inválida.');
    const [f] = await this.ds.query(`SELECT * FROM fichas_hospede WHERE ${where}`, params);
    if (!f) throw new NotFoundException('Ficha não encontrada.');
    const dados = { ...(f.dados ?? {}), ...limpa(dto.dados) };
    const falta = OBRIGATORIOS.filter((k) => !dados[k]);
    if (quem === 'hospede') {
      if (!dto.lgpd && !f.lgpd_aceito_em) throw new BadRequestException('É preciso aceitar o tratamento dos dados (LGPD).');
      if (falta.length) throw new BadRequestException('Preencha os campos obrigatórios (*).');
      if (!dados.estrangeiro && !(typeof dados.cpf === 'string' && dados.cpf.length === 11)) throw new BadRequestException('Informe o CPF (ou marque "Não sou brasileiro").');
    }
    const status = falta.length ? 'pendente' : 'preenchida';
    await this.ds.query(
      `UPDATE fichas_hospede SET dados = $2::jsonb, doc_foto = COALESCE($3::text, doc_foto), assinatura = COALESCE($4::text, assinatura),
        lgpd_aceito_em = CASE WHEN $5::boolean THEN COALESCE(lgpd_aceito_em, now()) ELSE lgpd_aceito_em END,
        status = $6::varchar, preenchida_por = CASE WHEN $6::varchar = 'preenchida' THEN COALESCE(preenchida_por, $7::varchar) ELSE preenchida_por END,
        preenchida_em = CASE WHEN $6::varchar = 'preenchida' THEN COALESCE(preenchida_em, now()) ELSE preenchida_em END, atualizado_em = now()
       WHERE id = $1`,
      [f.id, JSON.stringify(dados), dto.docFoto || null, dto.assinatura || null, !!dto.lgpd, status, quem]);
    // placa do hóspede vai para a conta, se ainda estiver vazia
    if (f.estadia_id && typeof dados.placa === 'string' && dados.placa) {
      await this.ds.query(`UPDATE estadias SET placa = $2 WHERE id = $1 AND (placa IS NULL OR placa = '')`, [f.estadia_id, String(dados.placa).slice(0, 10)]);
    }
    return { ok: true, status };
  }

  salvar(u: UsuarioToken, id: string, dto: SalvarFichaDto) {
    return this.gravar('id = $1 AND empresa_id = $2', [id, u.empresaId], dto, 'recepcao');
  }

  /* ---------- link público (QR para o hóspede) ---------- */

  async publica(token: string) {
    const [f] = await this.ds.query(
      `SELECT f.id, f.status, f.dados, f.lgpd_aceito_em, e.nome AS empresa FROM fichas_hospede f JOIN empresas e ON e.id = f.empresa_id WHERE f.token = $1`, [token]);
    if (!f) throw new NotFoundException('Link inválido.');
    if (f.status === 'preenchida') return { empresa: f.empresa, status: 'preenchida' };
    // o hóspede só vê o que ele mesmo digitou neste link
    return { empresa: f.empresa, status: f.status, dados: f.dados ?? {}, lgpdAceito: !!f.lgpd_aceito_em };
  }

  async enviarPublica(token: string, dto: SalvarFichaDto) {
    // o número oficial é só da recepção
    if (dto.dados) delete dto.dados.numeroOficial;
    const [f] = await this.ds.query(`SELECT status FROM fichas_hospede WHERE token = $1`, [token]);
    if (!f) throw new NotFoundException('Link inválido.');
    if (f.status === 'preenchida') throw new BadRequestException('Esta ficha já foi enviada. Fale com a recepção para corrigir.');
    return this.gravar('token = $1', [token], dto, 'hospede');
  }
}
