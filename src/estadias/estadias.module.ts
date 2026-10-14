import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Estadia } from './estadia.entity';
import { EstadiaItem } from './estadia-item.entity';
import { EstadiaPagamento } from './estadia-pagamento.entity';
import { EstadiaEvento } from './estadia-evento.entity';
import { Produto } from '../produtos/produto.entity';
import { Unidade } from '../unidades/unidade.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Perfil } from '../perfis/perfil.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Empresa } from '../empresas/empresa.entity';
import { TarifasModule } from '../tarifas/tarifas.module';
import { CaixaModule } from '../caixa/caixa.module';
import { GorjetasModule } from '../gorjetas/gorjetas.module';
import { CortesiasModule } from '../cortesias/cortesias.module';
import { FaturamentoModule } from '../faturamento/faturamento.module';
import { ImpressaoModule } from '../impressao/impressao.module';
import { EstadiasService } from './estadias.service';
import { EstadiasController } from './estadias.controller';
import { NotasService } from './notas.service';
import { NotasController } from './notas.controller';
import { SaidasService } from './saidas.service';
import { SaidasController } from './saidas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Estadia, EstadiaItem, EstadiaPagamento, EstadiaEvento, Unidade, UsuarioEntity, Perfil, Produto, Empresa, Ambiente]), TarifasModule, CaixaModule, GorjetasModule, CortesiasModule, FaturamentoModule, ImpressaoModule],
  providers: [EstadiasService, NotasService, SaidasService],
  controllers: [EstadiasController, NotasController, SaidasController],
  exports: [EstadiasService],
})
export class EstadiasModule {}
