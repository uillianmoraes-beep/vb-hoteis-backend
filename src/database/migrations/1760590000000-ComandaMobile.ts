import { MigrationInterface, QueryRunner } from 'typeorm';

/** Comanda mobile: o cliente pede pelo QR code da suíte/quarto; a recepção aceita e lança na conta. */
export class ComandaMobile1760590000000 implements MigrationInterface {
  name = 'ComandaMobile1760590000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS token_pedido varchar(24)`);
    await q.query(`UPDATE unidades SET token_pedido = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 20) WHERE token_pedido IS NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_unidades_token_pedido ON unidades(token_pedido)`);
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS cardapio boolean NOT NULL DEFAULT true`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        unidade_id uuid NOT NULL,
        estadia_id uuid NOT NULL,
        itens jsonb NOT NULL,
        total numeric(10,2) NOT NULL DEFAULT 0,
        observacao varchar(300),
        status varchar(10) NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','aceito','entregue','recusado')),
        motivo varchar(200),
        aceito_por varchar(120), aceito_em timestamptz,
        entregue_por varchar(120), entregue_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_pedidos_abertos ON pedidos(empresa_id, status, criado_em)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS pedidos`);
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS cardapio`);
    await q.query(`DROP INDEX IF EXISTS uq_unidades_token_pedido`);
    await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS token_pedido`);
  }
}
