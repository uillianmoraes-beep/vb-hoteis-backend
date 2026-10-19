import { Module } from '@nestjs/common';
import { ManualController } from './manual.controller';
import { ManualService } from './manual.service';

@Module({
  providers: [ManualService],
  controllers: [ManualController],
})
export class ManualModule {}
