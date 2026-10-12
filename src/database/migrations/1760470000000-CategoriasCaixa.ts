import { MigrationInterface, QueryRunner } from 'typeorm';

/** Entradas e saídas do caixa principal com categoria (fornecedor, passagem, padaria…), configuráveis por empresa. */
export class CategoriasCaixa1760470000000 implements MigrationInterface {
  name = 'CategoriasCaixa1760470000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE caixa_movimentos ADD COLUMN IF NOT EXISTS categoria varchar(60)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_caixa jsonb NOT NULL DEFAULT '{"saidas":["Pagamento de fornecedor","Passagem","Padaria","Outras despesas"],"entradas":["Reforço de troco","Outras entradas"]}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE caixa_movimentos DROP COLUMN IF EXISTS categoria`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_caixa`);
  }
}
