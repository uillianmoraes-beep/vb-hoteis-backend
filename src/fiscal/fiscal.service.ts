import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RegraFiscal } from './regra-fiscal.entity';
import { SalvarRegraDto } from './fiscal.dto';
import { Empresa } from '../empresas/empresa.entity';
import { limparFiscal } from '../common/fiscal';
import { moduloAtivo } from '../common/modulos';
import { UsuarioToken } from '../common/permissoes';

@Injectable()
export class FiscalService {
  constructor(
    @InjectRepository(RegraFiscal) private readonly repo: Repository<RegraFiscal>,
    @InjectRepository(Empresa) private readonly empresas: Repository<Empresa>,
  ) {}

  private async exigirModulo(u: UsuarioToken) {
    const e = await this.empresas.findOne({ where: { id: u.empresaId } });
    if (!moduloAtivo(e?.modulos, 'notas')) throw new ForbiddenException('Módulo de notas fiscais não contratado.');
  }

  async listar(u: UsuarioToken) {
    await this.exigirModulo(u);
    return this.repo.find({ where: { empresaId: u.empresaId }, order: { documento: 'ASC', cfop: 'ASC' } });
  }

  private async conferir(u: UsuarioToken, dto: SalvarRegraDto, ignorar?: string) {
    const cfop = dto.cfop ? dto.cfop.replace(/\D/g, '') : '';
    if (cfop && cfop.length !== 4) throw new BadRequestException('CFOP tem 4 números.');
    const qb = this.repo.createQueryBuilder('r')
      .where('r.empresaId = :e AND r.documento = :d', { e: u.empresaId, d: dto.documento });
    if (cfop) qb.andWhere('r.cfop = :c', { c: cfop });
    else qb.andWhere('r.cfop IS NULL');
    const outra = await qb.getOne();
    if (outra && outra.id !== ignorar) throw new BadRequestException(cfop ? `Já existe regra para o CFOP ${cfop} neste documento.` : 'Este documento já tem regra padrão.');
    return cfop || null;
  }

  async criar(u: UsuarioToken, dto: SalvarRegraDto) {
    await this.exigirModulo(u);
    const cfop = await this.conferir(u, dto);
    return this.repo.save(this.repo.create({
      empresaId: u.empresaId, documento: dto.documento, cfop, nome: dto.nome.trim(), dados: limparFiscal(dto.dados), ativo: dto.ativo ?? true,
    }));
  }

  async atualizar(u: UsuarioToken, id: string, dto: SalvarRegraDto) {
    await this.exigirModulo(u);
    const r = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!r) throw new NotFoundException('Regra não encontrada.');
    const cfop = await this.conferir(u, dto, id);
    Object.assign(r, { documento: dto.documento, cfop, nome: dto.nome.trim(), dados: limparFiscal(dto.dados), ativo: dto.ativo ?? r.ativo });
    return this.repo.save(r);
  }

  async remover(u: UsuarioToken, id: string) {
    await this.exigirModulo(u);
    const r = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!r) throw new NotFoundException('Regra não encontrada.');
    await this.repo.delete({ id });
    return { ok: true };
  }
}
