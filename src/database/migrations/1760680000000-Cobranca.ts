import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cobrança automática (Asaas): boleto/Pix das faturas e Pix do sinal da reserva online,
 * com baixa sozinha quando o banco avisa que foi pago.
 */
export class Cobranca1760680000000 implements MigrationInterface {
  name = 'Cobranca1760680000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cobranca jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE clientes_faturados ADD COLUMN IF NOT EXISTS asaas_cliente varchar(40)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cobrancas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        provedor varchar(12) NOT NULL DEFAULT 'asaas',
        externo_id varchar(40) NOT NULL,
        tipo varchar(16) NOT NULL,
        referencia_id uuid NOT NULL,
        forma varchar(10) NOT NULL,
        valor numeric(12,2) NOT NULL,
        vencimento date,
        status varchar(12) NOT NULL DEFAULT 'pendente',
        linha varchar(60),
        link varchar(300),
        pix_copia_cola text,
        pix_imagem text,
        pago_em timestamptz,
        valor_liquido numeric(12,2),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_cobrancas_externo ON cobrancas(provedor, externo_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cobrancas_ref ON cobrancas(tipo, referencia_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS cobrancas`);
    await q.query(`ALTER TABLE clientes_faturados DROP COLUMN IF EXISTS asaas_cliente`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS cobranca`);
  }
}
