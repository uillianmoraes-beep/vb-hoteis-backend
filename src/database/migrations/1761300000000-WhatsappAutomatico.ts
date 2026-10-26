import { MigrationInterface, QueryRunner } from 'typeorm';

/** WhatsApp automático pelo provedor da empresa (Z-API ou Evolution) e o registro do que foi enviado. */
export class WhatsappAutomatico1761300000000 implements MigrationInterface {
  name = 'WhatsappAutomatico1761300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS whatsapp_config jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_envios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        telefone varchar(20) NOT NULL,
        tipo varchar(20) NOT NULL,
        texto varchar(1000),
        ok boolean NOT NULL DEFAULT false,
        erro varchar(300),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_zap_envios ON whatsapp_envios (empresa_id, criado_em)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS whatsapp_envios`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS whatsapp_config`);
  }
}
