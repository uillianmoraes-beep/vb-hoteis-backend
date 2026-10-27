import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bens com depreciação (colchões, TVs, ar-condicionado, móveis, reformas) para a DRE mostrar EBITDA e depreciação,
 * e o custo da lavanderia por peça (preço por peça ou peso × preço do quilo) para o custo por locação.
 */
export class BensLavanderia1761390000000 implements MigrationInterface {
  name = 'BensLavanderia1761390000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS bens_depreciaveis (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        nome varchar(120) NOT NULL,
        categoria varchar(20) NOT NULL DEFAULT 'outro',
        quantidade int NOT NULL DEFAULT 1,
        valor numeric(12,2) NOT NULL,
        valor_residual numeric(12,2) NOT NULL DEFAULT 0,
        data_compra date NOT NULL,
        vida_util_meses int NOT NULL,
        baixado_em date,
        motivo_baixa varchar(200),
        observacao varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_bens_depreciaveis ON bens_depreciaveis(empresa_id)`);
    await q.query(`ALTER TABLE enxoval_tipos ADD COLUMN IF NOT EXISTS custo_lavagem numeric(10,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE enxoval_tipos ADD COLUMN IF NOT EXISTS peso_kg numeric(8,3) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE enxoval_config ADD COLUMN IF NOT EXISTS preco_kg numeric(10,2) NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE enxoval_config DROP COLUMN IF EXISTS preco_kg`);
    await q.query(`ALTER TABLE enxoval_tipos DROP COLUMN IF EXISTS peso_kg`);
    await q.query(`ALTER TABLE enxoval_tipos DROP COLUMN IF EXISTS custo_lavagem`);
    await q.query(`DROP TABLE IF EXISTS bens_depreciaveis`);
  }
}
