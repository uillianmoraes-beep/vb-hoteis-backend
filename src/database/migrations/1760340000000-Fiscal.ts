import { MigrationInterface, QueryRunner } from 'typeorm';

/** Tributação por produto/serviço e do serviço de hospedagem (por empresa). */
export class Fiscal1760340000000 implements MigrationInterface {
  name = 'Fiscal1760340000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS fiscal jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fiscal jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS fiscal`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS fiscal`);
  }
}
