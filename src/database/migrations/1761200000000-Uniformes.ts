import { MigrationInterface, QueryRunner } from 'typeorm';

/** Uniformes e EPI: peças com tamanho e CA, entrega ao funcionário (grátis, desconto no salário ou venda), devolução com estado e cobrança de avaria. */
export class Uniformes1761200000000 implements MigrationInterface {
  name = 'Uniformes1761200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS uniforme_itens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(100) NOT NULL,
        tipo varchar(12) NOT NULL DEFAULT 'uniforme',
        tamanho varchar(20),
        ca varchar(20),
        ca_validade date,
        custo numeric(12,2),
        preco_venda numeric(12,2),
        vida_util_dias int NOT NULL DEFAULT 180,
        quantidade int NOT NULL DEFAULT 0,
        estoque_minimo int NOT NULL DEFAULT 0,
        observacao varchar(200),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS uniforme_entregas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        item_id uuid NOT NULL REFERENCES uniforme_itens(id) ON DELETE CASCADE,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        quantidade int NOT NULL DEFAULT 1,
        data date NOT NULL,
        modo varchar(10) NOT NULL DEFAULT 'gratis',
        valor numeric(12,2) NOT NULL DEFAULT 0,
        forma varchar(10),
        troca_prevista date,
        observacao varchar(200),
        entregue_por varchar(120),
        devolvido_em date,
        estado varchar(10),
        motivo varchar(300),
        valor_cobrado numeric(12,2),
        recebido_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_unif_entregas ON uniforme_entregas (empresa_id, funcionario_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS uniforme_movimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        item_id uuid NOT NULL REFERENCES uniforme_itens(id) ON DELETE CASCADE,
        tipo varchar(12) NOT NULL,
        quantidade int NOT NULL,
        custo numeric(12,2),
        motivo varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["uniformes.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'uniformes.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['uniforme_movimentos', 'uniforme_entregas', 'uniforme_itens']) await q.query(`DROP TABLE IF EXISTS ${t}`);
  }
}
