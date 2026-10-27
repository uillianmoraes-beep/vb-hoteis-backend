import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Produto } from './produto.entity';
import { ProdutosService } from './produtos.service';
import { ProdutosController } from './produtos.controller';
import { FotosProdutoController, FotosProdutoService } from './fotos';
import { PrecificacaoModule } from '../precificacao/precificacao';

@Module({
  imports: [TypeOrmModule.forFeature([Produto]), PrecificacaoModule],
  providers: [ProdutosService, FotosProdutoService],
  controllers: [ProdutosController, FotosProdutoController],
  exports: [ProdutosService],
})
export class ProdutosModule {}
