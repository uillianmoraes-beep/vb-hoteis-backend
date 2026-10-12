import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { Empresa } from '../empresas/empresa.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CaixaModule } from '../caixa/caixa.module';

@Module({
  imports: [TypeOrmModule.forFeature([UsuarioEntity, Empresa]), CaixaModule],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
