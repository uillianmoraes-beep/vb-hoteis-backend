import { MigrationInterface, QueryRunner } from 'typeorm';

/** Cortesias prontas (30%, 50%, 100%…) criadas pelo dono, com regras de onde e até quando valem. */
export class Cortesias1760500000000 implements MigrationInterface {
  name = 'Cortesias1760500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS cortesias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        percentual numeric(5,2) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
        aplica_em varchar(12) NOT NULL DEFAULT 'total' CHECK (aplica_em IN ('total','hospedagem')),
        categoria_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        unidade_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        validade_ate date,
        exige_senha boolean NOT NULL DEFAULT false,
        cor varchar(9),
        descricao varchar(300),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS cortesia_nome varchar(80)`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["cortesias.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'cortesias.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS cortesias`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS cortesia_nome`);
  }
}
