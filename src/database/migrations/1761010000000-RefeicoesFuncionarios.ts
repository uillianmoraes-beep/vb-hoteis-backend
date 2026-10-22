import { MigrationInterface, QueryRunner } from 'typeorm';

/** Refeição dos funcionários: baixa do estoque e custo por funcionário, sem venda e sem caixa. */
export class RefeicoesFuncionarios1761010000000 implements MigrationInterface {
  name = 'RefeicoesFuncionarios1761010000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS refeicoes_funcionarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        ambiente_id uuid,
        data date NOT NULL,
        refeicao varchar(10) NOT NULL,
        funcionario_id uuid NOT NULL,
        funcionario_nome varchar(120) NOT NULL,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        custo numeric(12,2) NOT NULL DEFAULT 0,
        usuario_nome varchar(120),
        cancelada boolean NOT NULL DEFAULT false,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_refeicoes_func ON refeicoes_funcionarios (empresa_id, data)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS refeicoes_funcionarios`);
  }
}
