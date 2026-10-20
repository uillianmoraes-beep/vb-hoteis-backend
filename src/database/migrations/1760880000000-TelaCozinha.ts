import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tela da cozinha/bar: cada pedido de produção (consumo lançado, venda avulsa, comanda do celular)
 * entra na fila com os itens; a cozinha marca preparando → pronto → entregue. A impressão continua igual.
 */
export class TelaCozinha1760880000000 implements MigrationInterface {
  name = 'TelaCozinha1760880000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS producao_pedidos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        unidade_id uuid,
        local varchar(80),
        origem varchar(20) NOT NULL,
        usuario_nome varchar(120),
        obs varchar(300),
        status varchar(12) NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','preparando','pronto','entregue','cancelado')),
        criado_em timestamptz NOT NULL DEFAULT now(),
        iniciado_em timestamptz, pronto_em timestamptz, entregue_em timestamptz,
        atualizado_por varchar(120)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_producao_abertos ON producao_pedidos(empresa_id, status, criado_em)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS producao_itens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        pedido_id uuid NOT NULL REFERENCES producao_pedidos(id) ON DELETE CASCADE,
        produto_id uuid,
        nome varchar(120) NOT NULL,
        grupo varchar(60),
        quantidade numeric(10,3) NOT NULL,
        obs varchar(200)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS producao_itens`);
    await q.query(`DROP TABLE IF EXISTS producao_pedidos`);
  }
}
