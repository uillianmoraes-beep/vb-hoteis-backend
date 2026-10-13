import { Module } from '@nestjs/common';
import { FichasService } from './fichas.service';
import { FichasController } from './fichas.controller';

@Module({ providers: [FichasService], controllers: [FichasController] })
export class FichasModule {}
