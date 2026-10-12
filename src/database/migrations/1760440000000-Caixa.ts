import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caixa: turnos do caixa principal (recepção, por ambiente), movimentos
 * (sangria, reforço, despesa) e o caixa ADM (gerência, lançamentos contínuos).
 * Os recebimentos das contas ficam ligados ao turno aberto.
 */
export class Caixa1760440000000 implements MigrationInterface {
  name = 'Caixa1760440000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS caixa_turnos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL REFERENCES ambientes(id),
        numero integer NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado')),
        troco_inicial numeric(10,2) NOT NULL DEFAULT 0,
        aberto_por_id uuid, aberto_por varchar(120), aberto_em timestamptz NOT NULL DEFAULT now(),
        fechado_por_id uuid, fechado_por varchar(120), fechado_em timestamptz,
        esperado jsonb, contado jsonb, diferenca numeric(10,2), observacao text
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_caixa_turno_aberto ON caixa_turnos(empresa_id, ambiente_id) WHERE status = 'aberto'`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_caixa_turnos_data ON caixa_turnos(empresa_id, aberto_em)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS caixa_movimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        turno_id uuid REFERENCES caixa_turnos(id) ON DELETE CASCADE,
        caixa varchar(10) NOT NULL CHECK (caixa IN ('principal','adm')),
        tipo varchar(15) NOT NULL,
        forma varchar(20) NOT NULL DEFAULT 'dinheiro',
        valor numeric(10,2) NOT NULL CHECK (valor > 0),
        descricao varchar(300),
        usuario_id uuid, usuario_nome varchar(120), autorizado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_caixa_mov_turno ON caixa_movimentos(turno_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_caixa_mov_adm ON caixa_movimentos(empresa_id, caixa, criado_em)`);
    await q.query(`ALTER TABLE estadia_pagamentos ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES caixa_turnos(id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_pagamentos_turno ON estadia_pagamentos(turno_id)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_turno integer NOT NULL DEFAULT 0`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["caixa.principal","caixa.sangria","caixa.adm","caixa.relatorios"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'caixa.principal'`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["caixa.principal"]'::jsonb WHERE nome IN ('Recepção','Portaria') AND NOT permissoes ? 'caixa.principal'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadia_pagamentos DROP COLUMN IF EXISTS turno_id`);
    await q.query(`DROP TABLE IF EXISTS caixa_movimentos`);
    await q.query(`DROP TABLE IF EXISTS caixa_turnos`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS ultimo_turno`);
  }
}
