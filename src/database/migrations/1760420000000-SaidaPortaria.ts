import { MigrationInterface, QueryRunner } from 'typeorm';

/** Saída (portão): registra o ticket de liberação na saída do cliente. */
export class SaidaPortaria1760420000000 implements MigrationInterface {
  name = 'SaidaPortaria1760420000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS saida_portaria_em timestamptz`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS saida_portaria_por varchar(120)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS saida_portaria_situacao varchar(12)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estadias_saida_portaria ON estadias(empresa_id, saida_portaria_em) WHERE saida_portaria_em IS NOT NULL`);
    await q.query(`
      INSERT INTO perfis (empresa_id, nome, descricao, permissoes, limites)
      SELECT id, 'Saída', 'Portão de saída: confere o ticket de liberação', '["saida.registrar"]'::jsonb, '{}'::jsonb
      FROM empresas
      ON CONFLICT (empresa_id, nome) DO NOTHING`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["saida.registrar"]'::jsonb WHERE nome IN ('Gerente','Portaria') AND NOT permissoes ? 'saida.registrar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_estadias_saida_portaria`);
    for (const c of ['saida_portaria_situacao', 'saida_portaria_por', 'saida_portaria_em']) await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS ${c}`);
  }
}
