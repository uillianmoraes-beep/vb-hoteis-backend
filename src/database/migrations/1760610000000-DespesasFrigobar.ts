import { MigrationInterface, QueryRunner } from 'typeorm';

/** Contas a pagar: valor que varia todo mês (pede o valor), nota fiscal importada (XML). Frigobar por categoria. */
export class DespesasFrigobar1760610000000 implements MigrationInterface {
  name = 'DespesasFrigobar1760610000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS valor_variavel boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS valor_confirmado boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS chave_nfe varchar(44)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_contas_pagar_nfe ON contas_pagar(empresa_id, chave_nfe)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS frigobar_categoria (
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        categoria_id uuid NOT NULL,
        produto_id uuid NOT NULL,
        quantidade integer NOT NULL CHECK (quantidade > 0),
        PRIMARY KEY (categoria_id, produto_id)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS frigobar_categoria`);
    for (const c of ['valor_variavel', 'valor_confirmado', 'chave_nfe']) await q.query(`ALTER TABLE contas_pagar DROP COLUMN IF EXISTS ${c}`);
  }
}
