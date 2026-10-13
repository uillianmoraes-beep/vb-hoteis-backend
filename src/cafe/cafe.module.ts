import { Module } from '@nestjs/common';
import { CafeService } from './cafe.service';
import { CafeController } from './cafe.controller';

@Module({ providers: [CafeService], controllers: [CafeController] })
export class CafeModule {}
