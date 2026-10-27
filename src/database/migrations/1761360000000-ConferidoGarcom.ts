import { MigrationInterface, QueryRunner } from 'typeorm';

/** Conferência do garçom: o "Conferido" (gerente, garçom ou estoquista) e o garçom que entregou cada uso. */
export class ConferidoGarcom1761360000000 implements MigrationInterface {
  name = 'ConferidoGarcom1761360000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS conferencias_garcom (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        data date NOT NULL,
        turno varchar(80) NOT NULL,
        de timestamptz NOT NULL,
        ate timestamptz NOT NULL,
        ambiente_id uuid,
        papel varchar(12) NOT NULL CHECK (papel IN ('gerente','garcom','estoquista')),
        usuario_id uuid,
        usuario_nome varchar(120) NOT NULL,
        garcom varchar(120),
        total_itens numeric(12,3) NOT NULL DEFAULT 0,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        observacao varchar(300),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_conferencias_garcom_data ON conferencias_garcom(empresa_id, data)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS entregador_id uuid`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS entregador_nome varchar(120)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS entregador_nome`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS entregador_id`);
    await q.query(`DROP TABLE IF EXISTS conferencias_garcom`);
  }
}
