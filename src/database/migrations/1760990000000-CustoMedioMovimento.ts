import { MigrationInterface, QueryRunner } from 'typeorm';

/** Custo médio depois de cada movimento: a posição do estoque numa data passada sai com o custo daquele dia. */
export class CustoMedioMovimento1760990000000 implements MigrationInterface {
  name = 'CustoMedioMovimento1760990000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS custo_medio_depois numeric(14,4)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estoque_mov_posicao ON estoque_movimentos (empresa_id, local_id, produto_id, criado_em DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_estoque_mov_posicao`);
    await q.query(`ALTER TABLE estoque_movimentos DROP COLUMN IF EXISTS custo_medio_depois`);
  }
}
