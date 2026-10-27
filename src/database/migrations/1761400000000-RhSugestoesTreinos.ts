import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RH: escala sugerida pela ocupação (quantas pessoas por função), regras de comissão
 * e treinamentos com o checklist de integração de cada funcionário novo.
 */
export class RhSugestoesTreinos1761400000000 implements MigrationInterface {
  name = 'RhSugestoesTreinos1761400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_escala_sugerida jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_comissoes jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS treinamentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        titulo varchar(120) NOT NULL,
        descricao varchar(1000),
        funcao varchar(30),
        tipo varchar(10) NOT NULL DEFAULT 'tarefa' CHECK (tipo IN ('tarefa','video','texto','link')),
        url varchar(500),
        prazo_dias int NOT NULL DEFAULT 7,
        ordem int NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_treinamentos ON treinamentos(empresa_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS treinamento_feitos (
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        treinamento_id uuid NOT NULL REFERENCES treinamentos(id) ON DELETE CASCADE,
        empresa_id uuid NOT NULL,
        concluido_em timestamptz NOT NULL DEFAULT now(),
        confirmado_por varchar(120),
        observacao varchar(300),
        PRIMARY KEY (funcionario_id, treinamento_id)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS treinamento_feitos`);
    await q.query(`DROP TABLE IF EXISTS treinamentos`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_comissoes`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_escala_sugerida`);
  }
}
