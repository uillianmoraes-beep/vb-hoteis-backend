import { MigrationInterface, QueryRunner } from 'typeorm';

/** Hotel/pousada: diária por categoria (balcão), com valor de sexta/sábado e pessoa extra. */
export class DiariasHotel1760760000000 implements MigrationInterface {
  name = 'DiariasHotel1760760000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS diarias jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS diarias`);
  }
}
