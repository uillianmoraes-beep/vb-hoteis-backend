import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Funcionario, FuncionarioLancamento, Revisao } from './funcionario.entity';
import { FuncionariosService } from './funcionarios.service';
import { FuncionariosController } from './funcionarios.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Funcionario, FuncionarioLancamento, Revisao])],
  providers: [FuncionariosService],
  controllers: [FuncionariosController],
})
export class FuncionariosModule {}
