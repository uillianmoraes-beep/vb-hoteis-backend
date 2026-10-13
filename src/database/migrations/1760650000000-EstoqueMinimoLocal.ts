import { MigrationInterface, QueryRunner } from 'typeorm';

/** Estoque mínimo por local (cada ambiente avisa no seu Painel). */
export class EstoqueMinimoLocal1760650000000 implements MigrationInterface {
  name = 'EstoqueMinimoLocal1760650000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estoque_saldos ADD COLUMN IF NOT EXISTS minimo numeric(12,3) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estoque_saldos DROP COLUMN IF EXISTS minimo`);
  }
}
