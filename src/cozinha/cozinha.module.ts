import { Module } from '@nestjs/common';
import { CozinhaService } from './cozinha.service';
import { CozinhaController } from './cozinha.controller';

@Module({ providers: [CozinhaService], controllers: [CozinhaController] })
export class CozinhaModule {}
