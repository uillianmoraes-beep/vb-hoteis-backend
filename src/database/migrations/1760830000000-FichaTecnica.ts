import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ficha técnica: o produto vendido (ex.: contra filé com fritas) é feito de insumos do estoque.
 * Ao vender, baixa os insumos (quantidade da receita ÷ rendimento × quantidade vendida).
 */
export class FichaTecnica1760830000000 implements MigrationInterface {
  name = 'FichaTecnica1760830000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS produto_insumos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        insumo_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        quantidade numeric(12,4) NOT NULL CHECK (quantidade > 0),
        UNIQUE (produto_id, insumo_id)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_produto_insumos_produto ON produto_insumos(produto_id)`);
    // quantas porções a receita rende (as quantidades da ficha são da receita inteira)
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ficha_rendimento numeric(10,3) NOT NULL DEFAULT 1`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS ficha_rendimento`);
    await q.query(`DROP TABLE IF EXISTS produto_insumos`);
  }
}
