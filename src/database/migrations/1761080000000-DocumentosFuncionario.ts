import { MigrationInterface, QueryRunner } from 'typeorm';

/** Documentos do funcionário (RG, CTPS, contrato, exames…): o arquivo fica na pasta do servidor, o banco guarda o caminho. */
export class DocumentosFuncionario1761080000000 implements MigrationInterface {
  name = 'DocumentosFuncionario1761080000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_documentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        tipo varchar(20) NOT NULL,
        descricao varchar(120),
        validade date,
        nome_arquivo varchar(160) NOT NULL,
        mime varchar(40) NOT NULL,
        arquivo varchar(200) NOT NULL,
        bytes int NOT NULL,
        enviado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_func_docs ON funcionario_documentos (empresa_id, funcionario_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS funcionario_documentos`);
  }
}
