import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Estoque por local (centro de custo): cada ambiente tem o seu (Motel, Hotel, Café…),
 * com CNPJ quando a conta tem vários. Entrada manual ou pela nota (XML), transferência,
 * inventário e baixa automática no consumo.
 */
export class Estoque1760630000000 implements MigrationInterface {
  name = 'Estoque1760630000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS controla_estoque boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_minimo numeric(12,3) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS unidade varchar(8) NOT NULL DEFAULT 'un'`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS estoque_locais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        ambiente_id uuid,
        cnpj varchar(14),
        padrao boolean NOT NULL DEFAULT false,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS estoque_saldos (
        local_id uuid NOT NULL REFERENCES estoque_locais(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL,
        quantidade numeric(14,3) NOT NULL DEFAULT 0,
        custo_medio numeric(14,4) NOT NULL DEFAULT 0,
        PRIMARY KEY (local_id, produto_id)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS estoque_movimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        local_id uuid NOT NULL,
        produto_id uuid NOT NULL,
        tipo varchar(20) NOT NULL,
        quantidade numeric(14,3) NOT NULL,
        custo_unitario numeric(14,4) NOT NULL DEFAULT 0,
        saldo_depois numeric(14,3),
        documento varchar(60),
        referencia varchar(60),
        observacao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estoque_mov ON estoque_movimentos(empresa_id, criado_em)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estoque_mov_ref ON estoque_movimentos(referencia)`);
    // produto do fornecedor (código da nota) → produto da casa, com fator (1 caixa = 12 un)
    await q.query(`
      CREATE TABLE IF NOT EXISTS estoque_vinculos (
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        fornecedor varchar(14) NOT NULL,
        codigo varchar(60) NOT NULL,
        produto_id uuid NOT NULL,
        fator numeric(12,3) NOT NULL DEFAULT 1,
        PRIMARY KEY (empresa_id, fornecedor, codigo)
      )`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultima_transferencia integer NOT NULL DEFAULT 0`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["estoque.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'estoque.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['estoque_vinculos', 'estoque_movimentos', 'estoque_saldos', 'estoque_locais']) await q.query(`DROP TABLE IF EXISTS ${t}`);
    for (const c of ['controla_estoque', 'estoque_minimo', 'unidade']) await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS ${c}`);
  }
}
