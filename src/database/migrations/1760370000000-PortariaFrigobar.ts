import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portaria (dá entrada e recebe na entrada), pagamento antecipado
 * (abatido no fechamento) e itens de frigobar.
 */
export class PortariaFrigobar1760370000000 implements MigrationInterface {
  name = 'PortariaFrigobar1760370000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadia_pagamentos ADD COLUMN IF NOT EXISTS momento varchar(12) NOT NULL DEFAULT 'fechamento'`);
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS frigobar boolean NOT NULL DEFAULT false`);
    await q.query(`
      INSERT INTO perfis (empresa_id, nome, descricao, permissoes, limites)
      SELECT id, 'Portaria', 'Dá entrada nas suítes e recebe na entrada', '["painel.ver","estadias.entrada"]'::jsonb, '{}'::jsonb
      FROM empresas
      ON CONFLICT (empresa_id, nome) DO NOTHING`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["estadias.entrada"]'::jsonb WHERE nome IN ('Gerente','Recepção') AND NOT permissoes ? 'estadias.entrada'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS frigobar`);
    await q.query(`ALTER TABLE estadia_pagamentos DROP COLUMN IF EXISTS momento`);
  }
}
