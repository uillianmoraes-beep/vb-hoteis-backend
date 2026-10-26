import { MigrationInterface, QueryRunner } from 'typeorm';

/** Precificação: percentuais da estrutura do preço (tributos, cartão, despesas, comissão, lucro) guardados na empresa. */
export class Precificacao1761230000000 implements MigrationInterface {
  name = 'Precificacao1761230000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS precificacao jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS precificacao`);
  }
}
