import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gorjetas identificadas por pessoa (usuário que recebe gorjeta), em qualquer
 * forma de pagamento. Regra da casa: até X paga na hora (dinheiro); acima disso
 * ou no cartão/pix vai para repasse periódico, descontando a taxa combinada.
 */
export class Gorjetas1760450000000 implements MigrationInterface {
  name = 'Gorjetas1760450000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS recebe_gorjeta boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_gorjeta jsonb NOT NULL DEFAULT '{"limiteNaHora":10,"taxaPct":0,"periodo":"quinzenal"}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS gorjetas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid REFERENCES estadias(id) ON DELETE SET NULL,
        turno_id uuid REFERENCES caixa_turnos(id) ON DELETE SET NULL,
        origem varchar(10) NOT NULL CHECK (origem IN ('troco','adicional')),
        forma varchar(20) NOT NULL,
        valor numeric(10,2) NOT NULL CHECK (valor > 0),
        taxa_pct numeric(5,2) NOT NULL DEFAULT 0,
        valor_liquido numeric(10,2) NOT NULL,
        beneficiario_id uuid,
        beneficiario_nome varchar(120) NOT NULL,
        status varchar(12) NOT NULL CHECK (status IN ('paga_na_hora','a_repassar','repassada','casa')),
        repassada_em timestamptz, repassada_por varchar(120),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_gorjetas_pendentes ON gorjetas(empresa_id, beneficiario_nome) WHERE status = 'a_repassar'`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_gorjetas_turno ON gorjetas(turno_id)`);
    // gorjetas antigas (troco deixado) entram como pendentes de repasse
    await q.query(`
      INSERT INTO gorjetas (empresa_id, estadia_id, turno_id, origem, forma, valor, taxa_pct, valor_liquido, beneficiario_nome, status, usuario_nome, criado_em)
      SELECT empresa_id, estadia_id, turno_id, 'troco', 'dinheiro', troco, 0, troco, COALESCE(NULLIF(gorjeta_para, ''), 'Casa'),
             CASE WHEN COALESCE(NULLIF(gorjeta_para, ''), 'Casa') = 'Casa' THEN 'casa' ELSE 'a_repassar' END, usuario_nome, criado_em
      FROM estadia_pagamentos WHERE troco_destino = 'gorjeta' AND troco > 0`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["gorjetas.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'gorjetas.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS gorjetas`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_gorjeta`);
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS recebe_gorjeta`);
  }
}
