import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Certificado de reciclagem (com código para conferir pelo QR code) e o "faturar sozinho" do cliente faturado:
 * ao fechar a conta como faturado, a fatura, o boleto/Pix e a nota pendente saem na hora.
 */
export class ReciclagemFaturarSozinho1761410000000 implements MigrationInterface {
  name = 'ReciclagemFaturarSozinho1761410000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS certificados_reciclagem (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo varchar(12) NOT NULL UNIQUE,
        de date NOT NULL,
        ate date NOT NULL,
        comprador varchar(120),
        materiais jsonb NOT NULL DEFAULT '[]'::jsonb,
        equivalencias jsonb NOT NULL DEFAULT '[]'::jsonb,
        receita numeric(12,2) NOT NULL DEFAULT 0,
        emitido_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cert_reciclagem ON certificados_reciclagem(empresa_id, criado_em DESC)`);
    await q.query(`ALTER TABLE clientes_faturados ADD COLUMN IF NOT EXISTS auto_faturar boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE clientes_faturados ADD COLUMN IF NOT EXISTS auto_cobrar varchar(6) NOT NULL DEFAULT 'BOLETO'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE clientes_faturados DROP COLUMN IF EXISTS auto_cobrar`);
    await q.query(`ALTER TABLE clientes_faturados DROP COLUMN IF EXISTS auto_faturar`);
    await q.query(`DROP TABLE IF EXISTS certificados_reciclagem`);
  }
}
