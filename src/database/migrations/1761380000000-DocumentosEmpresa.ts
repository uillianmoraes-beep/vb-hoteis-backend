import { MigrationInterface, QueryRunner } from 'typeorm';

/** Documentos obrigatórios da empresa (alvará, bombeiros, dedetização, PCMSO…) com validade e aviso antes de vencer. */
export class DocumentosEmpresa1761380000000 implements MigrationInterface {
  name = 'DocumentosEmpresa1761380000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS empresa_documentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        tipo varchar(30) NOT NULL,
        descricao varchar(150),
        numero varchar(60),
        emissao date,
        validade date,
        avisar_dias int NOT NULL DEFAULT 30,
        responsavel varchar(120),
        nome_arquivo varchar(160),
        mime varchar(40),
        arquivo varchar(300),
        bytes int,
        enviado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_empresa_documentos ON empresa_documentos(empresa_id, tipo, criado_em DESC)`);
    // tipos que o estabelecimento não precisa (ex.: não tem piscina) — para não ficar avisando "falta"
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS documentos_dispensados jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS documentos_dispensados`);
    await q.query(`DROP TABLE IF EXISTS empresa_documentos`);
  }
}
