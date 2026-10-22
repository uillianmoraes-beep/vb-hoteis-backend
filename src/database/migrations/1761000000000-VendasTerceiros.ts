import { MigrationInterface, QueryRunner } from 'typeorm';

/** Venda a terceiros (latinhas, óleo usado, sucata, móveis e equipamentos velhos): registro + entrada no caixa ADM. */
export class VendasTerceiros1761000000000 implements MigrationInterface {
  name = 'VendasTerceiros1761000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS vendas_terceiros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        data date NOT NULL,
        tipo varchar(12) NOT NULL,
        descricao varchar(200) NOT NULL,
        quantidade numeric(12,3) NOT NULL DEFAULT 1,
        unidade varchar(10) NOT NULL DEFAULT 'un',
        valor_unitario numeric(12,2) NOT NULL DEFAULT 0,
        valor numeric(12,2) NOT NULL,
        forma varchar(20) NOT NULL,
        comprador varchar(120),
        documento varchar(18),
        telefone varchar(30),
        observacao varchar(300),
        cnpj varchar(14),
        cancelada boolean NOT NULL DEFAULT false,
        motivo_cancelamento varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_vendas_terceiros ON vendas_terceiros (empresa_id, data)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS vendas_terceiros`);
  }
}
