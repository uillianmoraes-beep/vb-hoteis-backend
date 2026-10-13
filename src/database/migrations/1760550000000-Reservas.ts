import { MigrationInterface, QueryRunner } from 'typeorm';

/** Reservas do hotel / pousada (mapa de reservas + check-in). */
export class Reservas1760550000000 implements MigrationInterface {
  name = 'Reservas1760550000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultima_reserva integer NOT NULL DEFAULT 0`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS reservas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero integer,
        unidade_id uuid NOT NULL,
        ambiente_id uuid NOT NULL,
        hospede varchar(120) NOT NULL,
        telefone varchar(30),
        email varchar(120),
        documento varchar(30),
        chegada date NOT NULL,
        saida date NOT NULL,
        adultos integer NOT NULL DEFAULT 2,
        criancas integer NOT NULL DEFAULT 0,
        valor_diaria numeric(12,2) NOT NULL DEFAULT 0,
        valor_total numeric(12,2) NOT NULL DEFAULT 0,
        sinal numeric(12,2) NOT NULL DEFAULT 0,
        sinal_forma varchar(12),
        origem varchar(30),
        observacao varchar(500),
        status varchar(12) NOT NULL DEFAULT 'confirmada' CHECK (status IN ('pendente','confirmada','hospedada','cancelada','no_show')),
        estadia_id uuid,
        motivo_cancelamento varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CHECK (saida > chegada)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_reservas_periodo ON reservas(empresa_id, chegada, saida)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_reservas_unidade ON reservas(unidade_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS reservas`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS ultima_reserva`);
  }
}
