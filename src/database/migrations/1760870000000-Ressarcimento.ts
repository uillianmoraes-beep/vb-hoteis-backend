import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Avarias e ressarcimento: item cobrado na conta pelo preço de reposição (roupão levado, copo quebrado)
 * que fica fora da nota fiscal (indenização, não venda). A vistoria registra o que faltou/quebrou.
 */
export class Ressarcimento1760870000000 implements MigrationInterface {
  name = 'Ressarcimento1760870000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS ressarcimento boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS avarias jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE vistorias DROP COLUMN IF EXISTS avarias`);
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS ressarcimento`);
  }
}
