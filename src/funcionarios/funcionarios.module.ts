import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Funcionario, FuncionarioLancamento, Revisao } from './funcionario.entity';
import { FuncionariosService } from './funcionarios.service';
import { FuncionariosController } from './funcionarios.controller';
import { RefeicoesController, RefeicoesService } from './refeicoes';
import { AniversariantesController, AniversariantesService } from './aniversariantes';
import { ContratoController, ContratoService } from './contrato';
import { DocumentosController, DocumentosService } from './documentos';
import { FeriasController, FeriasService } from './ferias';

@Module({
  imports: [TypeOrmModule.forFeature([Funcionario, FuncionarioLancamento, Revisao])],
  providers: [FuncionariosService, RefeicoesService, AniversariantesService, ContratoService, DocumentosService, FeriasService],
  exports: [ContratoService, FeriasService],
  controllers: [RefeicoesController, AniversariantesController, ContratoController, DocumentosController, FeriasController, FuncionariosController],
})
export class FuncionariosModule {}
