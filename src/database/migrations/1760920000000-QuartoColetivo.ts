import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quarto coletivo: cada cama é uma unidade com o código do quarto em "coletivo".
 * Reserva de empresa (grupo): quantas camas em cada noite; o sistema cria uma reserva por cama.
 */
export class QuartoColetivo1760920000000 implements MigrationInterface {
  name = 'QuartoColetivo1760920000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS coletivo varchar(20)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS reservas_grupo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        ambiente_id uuid NOT NULL,
        coletivo varchar(20) NOT NULL,
        cliente_faturado_id uuid,
        nome varchar(120) NOT NULL,
        telefone varchar(30),
        chegada date NOT NULL,
        saida date NOT NULL,
        camas jsonb NOT NULL DEFAULT '[]'::jsonb,
        valor_diaria numeric(10,2) NOT NULL DEFAULT 0,
        observacao text,
        status varchar(12) NOT NULL DEFAULT 'ativa',
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_reservas_grupo_empresa ON reservas_grupo (empresa_id, saida)`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS grupo_id uuid`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_reservas_grupo ON reservas (grupo_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS grupo_id`);
    await q.query(`DROP TABLE IF EXISTS reservas_grupo`);
    await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS coletivo`);
  }
}
