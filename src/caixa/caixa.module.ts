import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaixaMovimento, CaixaTurno } from './caixa.entity';
import { EstadiaPagamento } from '../estadias/estadia-pagamento.entity';
import { Estadia } from '../estadias/estadia.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Empresa } from '../empresas/empresa.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Gorjeta } from '../gorjetas/gorjeta.entity';
import { CaixaService } from './caixa.service';
import { CaixaController } from './caixa.controller';
import { PenhorasController } from './penhoras.controller';
import { Penhora } from './penhora.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CaixaTurno, CaixaMovimento, EstadiaPagamento, Estadia, Unidade, Ambiente, Empresa, UsuarioEntity, Gorjeta, Penhora])],
  providers: [CaixaService],
  controllers: [CaixaController, PenhorasController],
  exports: [CaixaService],
})
export class CaixaModule {}
