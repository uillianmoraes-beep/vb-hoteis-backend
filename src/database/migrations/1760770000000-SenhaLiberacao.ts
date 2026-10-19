import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Senha de liberação do gerente (só números, sem login) e histórico de liberações:
 * quem pediu, quem liberou, o quê, quanto e quando.
 */
export class SenhaLiberacao1760770000000 implements MigrationInterface {
  name = 'SenhaLiberacao1760770000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pin_hash varchar(100)`);
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pin_definido_em timestamptz`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS liberacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        estadia_id uuid,
        pedido_por_id uuid,
        pedido_por varchar(120),
        liberado_por_id uuid,
        liberado_por varchar(120) NOT NULL,
        acao varchar(120) NOT NULL,
        permissao varchar(60),
        detalhe varchar(300),
        valor numeric(12,2),
        meio varchar(8) NOT NULL DEFAULT 'login',
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_liberacoes_empresa ON liberacoes (empresa_id, criado_em DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS liberacoes`);
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS pin_definido_em`);
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS pin_hash`);
  }
}
