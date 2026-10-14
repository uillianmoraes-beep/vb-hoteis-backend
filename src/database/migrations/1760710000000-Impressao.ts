import { MigrationInterface, QueryRunner } from 'typeorm';

/** Impressão direta nas impressoras de rede (IP): comanda de preparo no bar/cozinha, sem a janela do navegador. */
export class Impressao1760710000000 implements MigrationInterface {
  name = 'Impressao1760710000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS impressoras (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(60) NOT NULL,
        endereco varchar(100) NOT NULL,
        porta integer NOT NULL DEFAULT 9100,
        colunas integer NOT NULL DEFAULT 48,
        ambiente_id uuid,
        grupos text[] NOT NULL DEFAULT '{}',
        copias integer NOT NULL DEFAULT 1,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS impressao_fila (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        impressora_id uuid NOT NULL REFERENCES impressoras(id) ON DELETE CASCADE,
        origem varchar(30) NOT NULL,
        texto text NOT NULL,
        dados text NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'pendente',
        tentativas integer NOT NULL DEFAULT 0,
        proxima_tentativa timestamptz,
        erro varchar(300),
        criado_em timestamptz NOT NULL DEFAULT now(),
        impresso_em timestamptz
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_impressao_fila_status ON impressao_fila(status, criado_em)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS impressao_agente_hash varchar(64)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS impressao_fila`);
    await q.query(`DROP TABLE IF EXISTS impressoras`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS impressao_agente_hash`);
  }
}
