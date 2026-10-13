import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Funcionários (com ou sem login), crachá, ficha financeira (vales, descontos, bônus,
 * pagamentos + gorjetas) e revisão completa das suítes pela governança.
 */
export class Funcionarios1760510000000 implements MigrationInterface {
  name = 'Funcionarios1760510000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultima_matricula integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_revisao jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        matricula integer NOT NULL,
        nome varchar(120) NOT NULL,
        funcao varchar(30) NOT NULL DEFAULT 'camareira',
        ambiente_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        telefone varchar(30),
        documento varchar(30),
        chave_pix varchar(120),
        admissao date,
        foto text,
        usuario_id uuid,
        recebe_gorjeta boolean NOT NULL DEFAULT false,
        observacao varchar(300),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionario_matricula ON funcionarios(empresa_id, matricula)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_lancamentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        tipo varchar(12) NOT NULL CHECK (tipo IN ('vale','desconto','bonus','pagamento')),
        valor numeric(10,2) NOT NULL CHECK (valor > 0),
        descricao varchar(300),
        data date NOT NULL,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_func_lanc ON funcionario_lancamentos(funcionario_id, data)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS revisoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        unidade_id uuid NOT NULL,
        camareira_id uuid,
        camareira_nome varchar(120),
        revisor_nome varchar(120),
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        aprovada boolean NOT NULL,
        nota integer,
        observacao varchar(500),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_revisoes ON revisoes(empresa_id, criado_em)`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["funcionarios.gerenciar","funcionarios.financeiro"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'funcionarios.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS revisoes`);
    await q.query(`DROP TABLE IF EXISTS funcionario_lancamentos`);
    await q.query(`DROP TABLE IF EXISTS funcionarios`);
  }
}
