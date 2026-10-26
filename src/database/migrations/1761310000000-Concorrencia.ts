import { MigrationInterface, QueryRunner } from 'typeorm';

/** Preço da concorrência: concorrentes da região e os preços anotados de cada um. */
export class Concorrencia1761310000000 implements MigrationInterface {
  name = 'Concorrencia1761310000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS concorrentes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(100) NOT NULL,
        link varchar(400),
        observacao varchar(300),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS concorrencia_precos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        concorrente_id uuid NOT NULL REFERENCES concorrentes(id) ON DELETE CASCADE,
        data date NOT NULL,
        categoria varchar(60) NOT NULL,
        valor numeric(12,2) NOT NULL,
        periodo varchar(40),
        fonte varchar(40),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_conc_precos ON concorrencia_precos (empresa_id, data)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS concorrencia_precos`);
    await q.query(`DROP TABLE IF EXISTS concorrentes`);
  }
}
