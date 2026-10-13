import { Module } from '@nestjs/common';
import { EnxovalService } from './enxoval.service';
import { EnxovalController } from './enxoval.controller';

@Module({ providers: [EnxovalService], controllers: [EnxovalController] })
export class EnxovalModule {}
