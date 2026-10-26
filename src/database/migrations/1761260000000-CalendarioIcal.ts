import { MigrationInterface, QueryRunner } from 'typeorm';

/** Calendário iCal com Airbnb, Booking e outros: link de exportação por quarto e calendários de fora que viram reservas. */
export class CalendarioIcal1761260000000 implements MigrationInterface {
  name = 'CalendarioIcal1761260000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS ical_token varchar(40)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_unidades_ical ON unidades(ical_token) WHERE ical_token IS NOT NULL`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS calendarios_externos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        unidade_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
        nome varchar(40) NOT NULL,
        url varchar(1000) NOT NULL,
        ativo boolean NOT NULL DEFAULT true,
        ultimo_sync timestamptz,
        ultimo_erro varchar(300),
        eventos int NOT NULL DEFAULT 0,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS calendario_id uuid`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS externo_uid varchar(200)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_reservas_calendario ON reservas(calendario_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_reservas_calendario`);
    await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS externo_uid`);
    await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS calendario_id`);
    await q.query(`DROP TABLE IF EXISTS calendarios_externos`);
    await q.query(`DROP INDEX IF EXISTS uq_unidades_ical`);
    await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS ical_token`);
  }
}
