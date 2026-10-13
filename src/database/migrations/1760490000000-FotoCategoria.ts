import { MigrationInterface, QueryRunner } from 'typeorm';

/** Foto da categoria, usada nas teclas do painel com foto. */
export class FotoCategoria1760490000000 implements MigrationInterface {
  name = 'FotoCategoria1760490000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE categorias ADD COLUMN IF NOT EXISTS foto text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE categorias DROP COLUMN IF EXISTS foto`);
  }
}
