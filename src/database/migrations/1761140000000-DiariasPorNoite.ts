import { MigrationInterface, QueryRunner } from 'typeorm';

/** Hotel: cada noite da hospedagem com a sua quantidade de pessoas e o seu valor (ex.: 2 noites de casal e a 3ª de uma pessoa só). */
export class DiariasPorNoite1761140000000 implements MigrationInterface {
  name = 'DiariasPorNoite1761140000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS noites jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS noites`);
  }
}
