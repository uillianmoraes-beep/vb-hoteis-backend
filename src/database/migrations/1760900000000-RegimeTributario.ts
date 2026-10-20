import { MigrationInterface, QueryRunner } from 'typeorm';

/** Regime tributário da empresa (Simples, MEI ou normal): o "Buscar tributação" preenche CSOSN/CST e PIS/COFINS por ele. */
export class RegimeTributario1760900000000 implements MigrationInterface {
  name = 'RegimeTributario1760900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS regime_tributario varchar(10)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS regime_tributario`);
  }
}
