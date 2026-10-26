import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pré-check-in: a ficha do hóspede pode nascer na reserva (o hóspede preenche antes de chegar) e passa para a conta no check-in. */
export class PreCheckin1761240000000 implements MigrationInterface {
  name = 'PreCheckin1761240000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE fichas_hospede ADD COLUMN IF NOT EXISTS reserva_id uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_fichas_reserva ON fichas_hospede(reserva_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_fichas_reserva`);
    await q.query(`ALTER TABLE fichas_hospede DROP COLUMN IF EXISTS reserva_id`);
  }
}
