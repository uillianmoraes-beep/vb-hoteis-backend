import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Funcionario, FuncionarioLancamento, Revisao } from './funcionario.entity';
import { FuncionariosService } from './funcionarios.service';
import { FuncionariosController } from './funcionarios.controller';
import { RefeicoesController, RefeicoesService } from './refeicoes';
import { AniversariantesController, AniversariantesService } from './aniversariantes';
import { ContratoController, ContratoService } from './contrato';
import { DocumentosController, DocumentosService } from './documentos';

@Module({
  imports: [TypeOrmModule.forFeature([Funcionario, FuncionarioLancamento, Revisao])],
  providers: [FuncionariosService, RefeicoesService, AniversariantesService, ContratoService, DocumentosService],
  exports: [ContratoService],
  controllers: [RefeicoesController, AniversariantesController, ContratoController, DocumentosController, FuncionariosController],
})
export class FuncionariosModule {}
