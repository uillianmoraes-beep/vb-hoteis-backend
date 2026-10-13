import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cortesia } from './cortesia.entity';
import { CortesiaDto } from './cortesias.dto';
import { UsuarioToken } from '../common/permissoes';

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

@Injectable()
export class CortesiasService {
  constructor(@InjectRepository(Cortesia) private readonly repo: Repository<Cortesia>) {}

  private formatar(c: Cortesia) {
    return { ...c, percentual: Number(c.percentual), vencida: !!c.validadeAte && c.validadeAte < hojeSP() };
  }

  async listar(u: UsuarioToken, todas = false) {
    const lista = await this.repo.find({ where: todas ? { empresaId: u.empresaId } : { empresaId: u.empresaId, ativo: true }, order: { percentual: 'ASC', nome: 'ASC' } });
    const f = lista.map((c) => this.formatar(c));
    return todas ? f : f.filter((c) => !c.vencida);
  }

  private dados(dto: CortesiaDto) {
    return {
      nome: dto.nome.trim(), percentual: dto.percentual.toFixed(2), aplicaEm: dto.aplicaEm ?? 'total',
      categoriaIds: dto.categoriaIds ?? [], unidadeIds: dto.unidadeIds ?? [], validadeAte: dto.validadeAte || null,
      exigeSenha: !!dto.exigeSenha, cor: dto.cor || null, descricao: dto.descricao?.trim() || null, ativo: dto.ativo ?? true,
    };
  }

  async criar(u: UsuarioToken, dto: CortesiaDto) {
    const c = await this.repo.save(this.repo.create({ empresaId: u.empresaId, ...this.dados(dto) }));
    return this.formatar(c);
  }

  async atualizar(u: UsuarioToken, id: string, dto: CortesiaDto) {
    const c = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!c) throw new NotFoundException('Cortesia não encontrada.');
    Object.assign(c, this.dados(dto));
    return this.formatar(await this.repo.save(c));
  }

  async remover(u: UsuarioToken, id: string) {
    const c = await this.repo.findOne({ where: { id, empresaId: u.empresaId } });
    if (!c) throw new NotFoundException('Cortesia não encontrada.');
    // não apaga (fica no histórico das contas): só desativa
    c.ativo = false;
    await this.repo.save(c);
    return { ok: true };
  }

  /** Confere se a cortesia vale para esta suíte hoje. */
  async paraConta(empresaId: string, id: string, unidadeId: string, categoriaId: string | null) {
    const c = await this.repo.findOne({ where: { id, empresaId, ativo: true } });
    if (!c) throw new BadRequestException('Cortesia não encontrada ou desativada.');
    if (c.validadeAte && c.validadeAte < hojeSP()) throw new BadRequestException(`A cortesia ${c.nome} venceu em ${c.validadeAte.split('-').reverse().join('/')}.`);
    if (c.unidadeIds.length && !c.unidadeIds.includes(unidadeId)) throw new BadRequestException(`A cortesia ${c.nome} não vale para esta suíte.`);
    if (c.categoriaIds.length && (!categoriaId || !c.categoriaIds.includes(categoriaId))) throw new BadRequestException(`A cortesia ${c.nome} não vale para esta categoria.`);
    return { ...c, pct: Number(c.percentual) };
  }
}
