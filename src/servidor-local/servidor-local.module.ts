import { Module } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { PonteService } from './ponte.service';
import { ServidorLocalService } from './servidor-local.service';
import { ServidorLocalController } from './servidor-local.controller';

@Module({ imports: [BackupModule, CobrancaModule], providers: [ServidorLocalService, PonteService], controllers: [ServidorLocalController], exports: [ServidorLocalService] })
export class ServidorLocalModule {}
