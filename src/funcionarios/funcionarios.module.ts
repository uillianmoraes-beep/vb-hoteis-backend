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
import { EscalaController, EscalaService } from './escala';
import { LicencasController, LicencasService } from './licencas';
import { BancoHorasController, BancoHorasService } from './banco-horas';
import { DesempenhoController, DesempenhoService, ProvaPublicaController } from './desempenho';

@Module({
  imports: [TypeOrmModule.forFeature([Funcionario, FuncionarioLancamento, Revisao])],
  providers: [FuncionariosService, RefeicoesService, AniversariantesService, ContratoService, DocumentosService, FeriasService, EscalaService, LicencasService, BancoHorasService, DesempenhoService],
  exports: [ContratoService, FeriasService, EscalaService, LicencasService, BancoHorasService],
  controllers: [RefeicoesController, AniversariantesController, ContratoController, DocumentosController, FeriasController, EscalaController, LicencasController, BancoHorasController, DesempenhoController, ProvaPublicaController, FuncionariosController],
})
export class FuncionariosModule {}
