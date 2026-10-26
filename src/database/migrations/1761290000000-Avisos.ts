import { MigrationInterface, QueryRunner } from 'typeorm';

/** Avisos no celular (notificações do navegador) e resumo diário por notificação/e-mail. */
export class Avisos1761290000000 implements MigrationInterface {
  name = 'Avisos1761290000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS sistema_config (chave varchar(60) PRIMARY KEY, valor jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS push_inscricoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        usuario_id uuid NOT NULL,
        endpoint varchar(1000) NOT NULL UNIQUE,
        chaves jsonb NOT NULL,
        aparelho varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_push_empresa ON push_inscricoes (empresa_id)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS avisos_config jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS avisos_config`);
    await q.query(`DROP TABLE IF EXISTS push_inscricoes`);
    await q.query(`DROP TABLE IF EXISTS sistema_config`);
  }
}
