import { MigrationInterface, QueryRunner } from 'typeorm';

/** Chamados do totem de autoatendimento para a recepção (suíte escolhida, check-in, ajuda). */
export class Totem1761280000000 implements MigrationInterface {
  name = 'Totem1761280000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS totem_chamados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        tipo varchar(10) NOT NULL,
        unidade_id uuid,
        reserva_id uuid,
        texto varchar(200) NOT NULL,
        observacao varchar(200),
        status varchar(10) NOT NULL DEFAULT 'novo',
        atendido_por varchar(120),
        atendido_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_totem_chamados ON totem_chamados (empresa_id, status, criado_em)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS totem_chamados`);
  }
}
