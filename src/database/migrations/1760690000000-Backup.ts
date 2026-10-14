import { MigrationInterface, QueryRunner } from 'typeorm';

/** Backups por empresa: rotina automática configurável e cópias guardadas. */
export class Backup1760690000000 implements MigrationInterface {
  name = 'Backup1760690000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_backup jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS backups_arquivos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        tipo varchar(10) NOT NULL,
        tamanho integer NOT NULL,
        tabelas integer NOT NULL,
        registros integer NOT NULL,
        protegido boolean NOT NULL DEFAULT false,
        conteudo bytea NOT NULL,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_backups_empresa ON backups_arquivos(empresa_id, criado_em DESC)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS backups_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        acao varchar(20) NOT NULL,
        detalhe varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS backups_log`);
    await q.query(`DROP TABLE IF EXISTS backups_arquivos`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_backup`);
  }
}
