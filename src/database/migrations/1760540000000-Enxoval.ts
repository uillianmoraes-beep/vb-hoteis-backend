import { MigrationInterface, QueryRunner } from 'typeorm';

/** Enxoval por quantidade (sem etiqueta): rouparia, lavanderia, em uso, perdas e ciclo de lavagem. */
export class Enxoval1760540000000 implements MigrationInterface {
  name = 'Enxoval1760540000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS enxoval_tipos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        total integer NOT NULL DEFAULT 0,
        rouparia integer NOT NULL DEFAULT 0,
        lavanderia integer NOT NULL DEFAULT 0,
        lavagens bigint NOT NULL DEFAULT 0,
        limite_lavagens integer NOT NULL DEFAULT 240,
        custo numeric(10,2) NOT NULL DEFAULT 0,
        perdas integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS enxoval_movimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        tipo_id uuid NOT NULL REFERENCES enxoval_tipos(id) ON DELETE CASCADE,
        movimento varchar(20) NOT NULL,
        quantidade integer NOT NULL,
        origem varchar(12),
        unidade varchar(20),
        responsavel varchar(120),
        observacao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_enxoval_mov ON enxoval_movimentos(empresa_id, criado_em)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS enxoval_kits (
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        categoria_id uuid NOT NULL,
        tipo_id uuid NOT NULL REFERENCES enxoval_tipos(id) ON DELETE CASCADE,
        quantidade integer NOT NULL CHECK (quantidade > 0),
        PRIMARY KEY (categoria_id, tipo_id)
      )`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["enxoval.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'enxoval.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS enxoval_kits`);
    await q.query(`DROP TABLE IF EXISTS enxoval_movimentos`);
    await q.query(`DROP TABLE IF EXISTS enxoval_tipos`);
  }
}
