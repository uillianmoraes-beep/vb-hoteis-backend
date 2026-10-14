import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Servidor local (instalado no cliente, funciona sem internet):
 * - na nuvem: chaves de assinatura das licenças e o token de cada servidor local;
 * - no servidor local: a licença guardada (renovada sozinha quando há internet).
 */
export class ServidorLocal1760700000000 implements MigrationInterface {
  name = 'ServidorLocal1760700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS sistema_config (chave varchar(60) PRIMARY KEY, valor text NOT NULL, criado_em timestamptz NOT NULL DEFAULT now())`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS servidor_token_hash varchar(64)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS servidor_local jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS licenca_local (
        id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        empresa_id uuid NOT NULL,
        nuvem_url varchar(200) NOT NULL,
        token_cripto text NOT NULL,
        chave_publica text NOT NULL,
        licenca text,
        valida_ate timestamptz,
        modulos jsonb NOT NULL DEFAULT '{}'::jsonb,
        ativado_em timestamptz NOT NULL DEFAULT now(),
        ultima_renovacao timestamptz,
        ultimo_erro varchar(300)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS licenca_local`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS servidor_local`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS servidor_token_hash`);
    await q.query(`DROP TABLE IF EXISTS sistema_config`);
  }
}
