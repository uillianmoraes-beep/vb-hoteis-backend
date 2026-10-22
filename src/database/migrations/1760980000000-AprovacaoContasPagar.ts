import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aprovação do financeiro nas contas a pagar: o que o setor de compras lança (nota e boletos)
 * espera o financeiro conferir e aprovar antes de poder pagar.
 */
export class AprovacaoContasPagar1760980000000 implements MigrationInterface {
  name = 'AprovacaoContasPagar1760980000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS aprovacao varchar(10) NOT NULL DEFAULT 'aprovada'`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS lote_id uuid`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS nota_total numeric(12,2)`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS aprovado_por varchar(120)`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS aprovado_em timestamptz`);
    await q.query(`ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS motivo_recusa varchar(300)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_contas_pagar_aprovacao ON contas_pagar (empresa_id) WHERE aprovacao <> 'aprovada'`);
    // quem já cuida das despesas continua lançando sem esperar aprovação
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["despesas.aprovar"]'::jsonb WHERE permissoes ? 'despesas.gerenciar' AND NOT permissoes ? 'despesas.aprovar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_contas_pagar_aprovacao`);
    for (const c of ['motivo_recusa', 'aprovado_em', 'aprovado_por', 'nota_total', 'lote_id', 'aprovacao']) {
      await q.query(`ALTER TABLE contas_pagar DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
