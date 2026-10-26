import { MigrationInterface, QueryRunner } from 'typeorm';

/** Faturar num clique: a fatura guarda a nota (pendente/emitida com o número) e a conciliação liga o crédito do banco à fatura paga por transferência/Pix. */
export class FaturarUmClique1761210000000 implements MigrationInterface {
  name = 'FaturarUmClique1761210000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE faturas ADD COLUMN IF NOT EXISTS nota_status varchar(10) NOT NULL DEFAULT 'nao'`);
    await q.query(`ALTER TABLE faturas ADD COLUMN IF NOT EXISTS nota_numero varchar(30)`);
    await q.query(`ALTER TABLE faturas ADD COLUMN IF NOT EXISTS nota_emitida_em timestamptz`);
    await q.query(`ALTER TABLE faturas ADD COLUMN IF NOT EXISTS nota_emitida_por varchar(120)`);
    await q.query(`ALTER TABLE faturas ADD COLUMN IF NOT EXISTS enviada_em timestamptz`);
    await q.query(`ALTER TABLE conciliacao_linhas ADD COLUMN IF NOT EXISTS fatura_id uuid`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE conciliacao_linhas DROP COLUMN IF EXISTS fatura_id`);
    for (const c of ['enviada_em', 'nota_emitida_por', 'nota_emitida_em', 'nota_numero', 'nota_status']) await q.query(`ALTER TABLE faturas DROP COLUMN IF EXISTS ${c}`);
  }
}
