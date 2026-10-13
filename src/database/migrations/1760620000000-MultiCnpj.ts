import { MigrationInterface, QueryRunner } from 'typeorm';

/** Vários CNPJs na mesma conta: CNPJ por ambiente e nos lançamentos financeiros (null = empresa principal). */
export class MultiCnpj1760620000000 implements MigrationInterface {
  name = 'MultiCnpj1760620000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS cnpj varchar(18)`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS razao_social varchar(150)`);
    for (const t of ['caixa_movimentos', 'contas_pagar', 'contas_receber', 'faturas']) {
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS cnpj varchar(14)`);
    }
    // o que veio de um turno do caixa já sabe o ambiente
    await q.query(`
      UPDATE caixa_movimentos m SET cnpj = regexp_replace(a.cnpj, '\\D', '', 'g')
        FROM caixa_turnos t JOIN ambientes a ON a.id = t.ambiente_id
       WHERE m.turno_id = t.id AND m.cnpj IS NULL AND a.cnpj IS NOT NULL AND a.cnpj <> ''`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['caixa_movimentos', 'contas_pagar', 'contas_receber', 'faturas']) await q.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS cnpj`);
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS razao_social`);
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS cnpj`);
  }
}
