import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cadastro único com "Usado em": cada produto diz em quais ambientes aparece (Motel, Hotel…).
 * Vazio = em todos. O Centro de distribuição vê tudo; as telas de venda mostram só os do ambiente.
 */
export class ProdutoAmbientes1760860000000 implements MigrationInterface {
  name = 'ProdutoAmbientes1760860000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ambientes_ids uuid[]`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS ambientes_ids`);
  }
}
