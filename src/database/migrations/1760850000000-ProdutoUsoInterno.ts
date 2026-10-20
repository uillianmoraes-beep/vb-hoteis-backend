import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Produto para venda × uso interno (ingredientes, papel higiênico, limpeza): o de uso interno
 * não tem preço de venda e não aparece nas telas de venda; continua no estoque, ficha técnica, cortes e compras.
 */
export class ProdutoUsoInterno1760850000000 implements MigrationInterface {
  name = 'ProdutoUsoInterno1760850000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS uso varchar(10) NOT NULL DEFAULT 'venda'`);
    // ingredientes já usados em ficha técnica ou corte e sem preço viram uso interno
    await q.query(`UPDATE produtos p SET uso = 'interno' WHERE p.preco = 0 AND p.tipo = 'produto'
      AND (EXISTS (SELECT 1 FROM produto_insumos i WHERE i.insumo_id = p.id) OR EXISTS (SELECT 1 FROM cortes_modelos m WHERE m.materia_id = p.id))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS uso`);
  }
}
