import { Body, Controller, ForbiddenException, Get, Headers, NotFoundException, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { timingSafeEqual } from 'crypto';
import { Publico } from '../common/decorators/publico.decorator';
import { Empresa } from '../empresas/empresa.entity';
import { MODULOS } from '../common/modulos';

/**
 * Liberação de módulos pela Virtual Barra (revenda). Protegido pela chave
 * mestra da variável VB_CHAVE_MESTRA, enviada no cabeçalho x-chave-mestra.
 * Sem a variável configurada, a rota fica desligada.
 */
@Controller('licenca')
export class LicencaController {
  constructor(@InjectRepository(Empresa) private readonly empresas: Repository<Empresa>) {}

  private conferir(chave?: string) {
    const mestra = process.env.VB_CHAVE_MESTRA;
    if (!mestra || mestra.length < 24) throw new NotFoundException();
    const a = Buffer.from(chave ?? '');
    const b = Buffer.from(mestra);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException('Chave inválida.');
  }

  @Get()
  @Publico()
  async listar(@Headers('x-chave-mestra') chave?: string) {
    this.conferir(chave);
    const lista = await this.empresas.find({ order: { nome: 'ASC' } });
    return { modulos: MODULOS, empresas: lista.map((e) => ({ id: e.id, nome: e.nome, modulos: e.modulos ?? {} })) };
  }

  @Put(':empresaId')
  @Publico()
  async definir(
    @Headers('x-chave-mestra') chave: string | undefined,
    @Param('empresaId', ParseUUIDPipe) empresaId: string,
    @Body() corpo: Record<string, unknown>,
  ) {
    this.conferir(chave);
    const e = await this.empresas.findOne({ where: { id: empresaId } });
    if (!e) throw new NotFoundException('Empresa não encontrada.');
    const modulos: Record<string, boolean> = { ...(e.modulos ?? {}) };
    for (const k of Object.keys(MODULOS)) if (corpo?.[k] !== undefined) modulos[k] = !!corpo[k];
    await this.empresas.update({ id: empresaId }, { modulos });
    return { id: e.id, nome: e.nome, modulos };
  }
}
