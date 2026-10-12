import { MigrationInterface, QueryRunner } from 'typeorm';

/** Governança (mesário da limpeza) e acesso pelo celular por usuário. */
export class Governanca1760410000000 implements MigrationInterface {
  name = 'Governanca1760410000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS acesso_celular boolean NOT NULL DEFAULT true`);
    await q.query(`
      INSERT INTO perfis (empresa_id, nome, descricao, permissoes, limites)
      SELECT id, 'Governança', 'Mesário da limpeza: camareiras, vistoria e liberação', '["painel.ver","unidades.status","unidades.bloquear","governanca.operar"]'::jsonb, '{}'::jsonb
      FROM empresas
      ON CONFLICT (empresa_id, nome) DO NOTHING`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["governanca.operar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'governanca.operar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS acesso_celular`);
  }
}
