import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ambiente } from './ambiente.entity';
import { AtualizarAmbienteDto, CriarAmbienteDto } from './ambientes.dto';

@Injectable()
export class AmbientesService {
  constructor(@InjectRepository(Ambiente) private readonly repo: Repository<Ambiente>) {}

  listar(empresaId: string, incluirInativos = false) {
    return this.repo.find({
      where: incluirInativos ? { empresaId } : { empresaId, ativo: true },
      order: { ordem: 'ASC', nome: 'ASC' },
    });
  }

  async buscar(empresaId: string, id: string) {
    const item = await this.repo.findOne({ where: { id, empresaId } });
    if (!item) throw new NotFoundException('Ambiente não encontrado.');
    return item;
  }

  criar(empresaId: string, dto: CriarAmbienteDto) {
    return this.repo.save(this.repo.create({ ...dto, empresaId }));
  }

  async atualizar(empresaId: string, id: string, dto: AtualizarAmbienteDto) {
    const item = await this.buscar(empresaId, id);
    if (dto.cnpj !== undefined) dto.cnpj = dto.cnpj.replace(/\D/g, '') || (null as unknown as string);
    if (dto.razaoSocial !== undefined) dto.razaoSocial = dto.razaoSocial.trim() || (null as unknown as string);
    Object.assign(item, dto);
    return this.repo.save(item);
  }

  /** Não apaga: desativa, para não perder histórico. */
  async desativar(empresaId: string, id: string) {
    const item = await this.buscar(empresaId, id);
    item.ativo = false;
    return this.repo.save(item);
  }

  async cnpjs(empresaId: string) {
    const [e] = await this.repo.query(`SELECT nome, cnpj FROM empresas WHERE id = $1`, [empresaId]);
    const ambs: { nome: string; cnpj: string | null; razao_social: string | null }[] = await this.repo.query(
      `SELECT nome, cnpj, razao_social FROM ambientes WHERE empresa_id = $1 AND ativo ORDER BY ordem, nome`, [empresaId]);
    const dig = (s?: string | null) => (s ?? '').replace(/\D/g, '');
    const principal = dig(e?.cnpj);
    const lista: { valor: string; nome: string; documento: string | null; ambientes: string[] }[] = [
      { valor: 'principal', nome: e?.nome ?? 'Empresa', documento: principal || null, ambientes: [] },
    ];
    for (const a of ambs) {
      const c = dig(a.cnpj);
      if (!c || c === principal) { lista[0].ambientes.push(a.nome); continue; }
      const ja = lista.find((x) => x.valor === c);
      if (ja) ja.ambientes.push(a.nome);
      else lista.push({ valor: c, nome: a.razao_social || a.nome, documento: c, ambientes: [a.nome] });
    }
    return lista;
  }
}
