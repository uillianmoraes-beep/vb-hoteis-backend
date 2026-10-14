import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class ConfigBackupDto {
  @IsBoolean() automatico!: boolean;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) horario!: string;
  @IsInt() @Min(1) @Max(60) manter!: number;
  /** senha dos backups automáticos (vazio = mantém a atual) */
  @IsOptional() @IsString() @MinLength(6) @MaxLength(100) senha?: string;
  @IsOptional() @IsBoolean() tirarSenha?: boolean;
}

export class BackupAgoraDto {
  @IsOptional() @IsString() @MaxLength(100) senha?: string;
}
