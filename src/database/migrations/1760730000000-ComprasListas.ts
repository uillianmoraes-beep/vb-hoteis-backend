import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Compras: listas padrão de itens (ex.: "Hortifruti da semana"), entrada no estoque
 * direto do pedido de compra e índice para o histórico de preços por produto.
 */
export class ComprasListas1760730000000 implements MigrationInterface {
  name = 'ComprasListas1760730000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS cotacao_modelos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, nome)
      )`);
    await q.query(`ALTER TABLE cotacao_fornecedores ADD COLUMN IF NOT EXISTS recebido_em timestamptz`);
    await q.query(`ALTER TABLE cotacao_fornecedores ADD COLUMN IF NOT EXISTS recebido_por varchar(120)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cotacao_itens_produto ON cotacao_itens (produto_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cotacao_itens_cotacao ON cotacao_itens (cotacao_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cotacoes_empresa ON cotacoes (empresa_id, criado_em DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS cotacao_modelos`);
    await q.query(`ALTER TABLE cotacao_fornecedores DROP COLUMN IF EXISTS recebido_em`);
    await q.query(`ALTER TABLE cotacao_fornecedores DROP COLUMN IF EXISTS recebido_por`);
  }
}
