import { MigrationInterface, QueryRunner } from 'typeorm';

/** Reserva nova (ex.: feita online) fica piscando no painel até a recepção ver. */
export class ReservaVista1760580000000 implements MigrationInterface {
  name = 'ReservaVista1760580000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS vista_em timestamptz`);
    // as que já existem foram feitas pela recepção: já vistas
    await q.query(`UPDATE reservas SET vista_em = criado_em WHERE vista_em IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS vista_em`);
  }
}
