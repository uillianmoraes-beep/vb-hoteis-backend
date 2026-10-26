import { MigrationInterface, QueryRunner } from 'typeorm';

/** Fundo da tela inicial guardado na empresa (foto real ou em desenho), para todos os computadores. */
export class FundoPainelEmpresa1761320000000 implements MigrationInterface {
  name = 'FundoPainelEmpresa1761320000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fundo_painel jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS fundo_painel`);
  }
}
