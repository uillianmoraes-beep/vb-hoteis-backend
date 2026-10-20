import { MigrationInterface, QueryRunner } from 'typeorm';

/** Série e próximo número da NF-e e da NFC-e, por CNPJ (motel e hotel podem ter CNPJs diferentes). */
export class NumeracaoFiscal1760910000000 implements MigrationInterface {
  name = 'NumeracaoFiscal1760910000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS numeracao_fiscal jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS numeracao_fiscal`);
  }
}
