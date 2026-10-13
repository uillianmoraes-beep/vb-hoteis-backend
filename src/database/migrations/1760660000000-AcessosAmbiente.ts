import { MigrationInterface, QueryRunner } from 'typeorm';

/** Registro de em qual ambiente (motel/hotel) cada operador entrou e das trocas (com senha). */
export class AcessosAmbiente1760660000000 implements MigrationInterface {
  name = 'AcessosAmbiente1760660000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS acessos_ambiente (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id uuid NOT NULL,
        usuario_nome varchar(120) NOT NULL,
        tipo varchar(10) NOT NULL,
        de_ambiente_id uuid,
        para_ambiente_id uuid NOT NULL,
        ip varchar(60),
        agente varchar(200),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_acessos_ambiente ON acessos_ambiente(empresa_id, criado_em)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS acessos_ambiente`);
  }
}
