import { MigrationInterface, QueryRunner } from 'typeorm';

/** Lote 2: aparência da empresa (tema e cores dos status). */
export class Aparencia1760280000000 implements MigrationInterface {
  name = 'Aparencia1760280000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS aparencia jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS aparencia`);
  }
}
