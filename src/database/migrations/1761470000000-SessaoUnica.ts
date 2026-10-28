import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Um computador por vez: cada login gera uma sessão nova; o acesso aberto em outro computador cai.
 * O gerente pode liberar um usuário para usar vários computadores ao mesmo tempo.
 */
export class SessaoUnica1761470000000 implements MigrationInterface {
  name = 'SessaoUnica1761470000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_id uuid`);
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS varias_sessoes boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS varias_sessoes`);
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS sessao_id`);
  }
}
