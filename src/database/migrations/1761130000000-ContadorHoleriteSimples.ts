import { MigrationInterface, QueryRunner } from 'typeorm';

/** Área do contador: holerites conferidos (com as tabelas INSS/IRRF editáveis) e o extrato do Simples (PGDAS-D) cruzado com o faturamento. */
export class ContadorHoleriteSimples1761130000000 implements MigrationInterface {
  name = 'ContadorHoleriteSimples1761130000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS holerites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        competencia char(7) NOT NULL,
        tipo varchar(12) NOT NULL DEFAULT 'mensal',
        dados jsonb NOT NULL,
        documento_id uuid REFERENCES funcionario_documentos(id) ON DELETE SET NULL,
        status varchar(12) NOT NULL,
        divergencias int NOT NULL DEFAULT 0,
        atencoes int NOT NULL DEFAULT 0,
        liquido numeric(12,2),
        observacao varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (funcionario_id, competencia, tipo)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_holerites ON holerites (empresa_id, competencia)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS simples_apuracoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        cnpj_basico char(8) NOT NULL,
        competencia char(7) NOT NULL,
        dados jsonb NOT NULL,
        arquivo varchar(300),
        mime varchar(40),
        nome_arquivo varchar(160),
        status varchar(12) NOT NULL,
        divergencias int NOT NULL DEFAULT 0,
        atencoes int NOT NULL DEFAULT 0,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, cnpj_basico, competencia)
      )`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS tabelas_folha jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE rh_config DROP COLUMN IF EXISTS tabelas_folha`);
    await q.query(`DROP TABLE IF EXISTS simples_apuracoes`);
    await q.query(`DROP TABLE IF EXISTS holerites`);
  }
}
