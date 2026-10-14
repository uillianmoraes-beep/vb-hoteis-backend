import { Module } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { ServidorLocalService } from './servidor-local.service';
import { ServidorLocalController } from './servidor-local.controller';

@Module({ imports: [BackupModule], providers: [ServidorLocalService], controllers: [ServidorLocalController], exports: [ServidorLocalService] })
export class ServidorLocalModule {}
