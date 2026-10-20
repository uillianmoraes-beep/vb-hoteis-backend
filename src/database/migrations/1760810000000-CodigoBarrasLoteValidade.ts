import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Código de barras (EAN/GTIN) no produto, para achar pelo leitor ou pela câmera,
 * e lote + validade nas entradas de estoque (aviso de produto vencendo).
 */
export class CodigoBarrasLoteValidade1760810000000 implements MigrationInterface {
  name = 'CodigoBarrasLoteValidade1760810000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS codigo_barras varchar(20)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(empresa_id, codigo_barras) WHERE codigo_barras IS NOT NULL`);
    await q.query(`ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS lote varchar(40)`);
    await q.query(`ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS validade date`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estoque_mov_validade ON estoque_movimentos(empresa_id, validade) WHERE validade IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_estoque_mov_validade`);
    await q.query(`ALTER TABLE estoque_movimentos DROP COLUMN IF EXISTS validade`);
    await q.query(`ALTER TABLE estoque_movimentos DROP COLUMN IF EXISTS lote`);
    await q.query(`DROP INDEX IF EXISTS idx_produtos_codigo_barras`);
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS codigo_barras`);
  }
}
