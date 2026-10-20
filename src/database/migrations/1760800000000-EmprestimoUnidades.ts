import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emprestar quartos de um ambiente para outro (ex.: hotel vazio no fim de semana → motel).
 * Enquanto emprestada, a unidade fica no ambiente de destino (ambiente_id) e cobra como uma
 * categoria de lá; a categoria de origem fica guardada para a volta. O empréstimo automático
 * (janela da semana, ex.: sexta 18h a domingo 12h) fica no ambiente de origem.
 */
export class EmprestimoUnidades1760800000000 implements MigrationInterface {
  name = 'EmprestimoUnidades1760800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS categoria_padrao_id uuid`);
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS emprestada_em timestamptz`);
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS emprestimo_auto boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS emprestimo jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['categoria_padrao_id', 'emprestada_em', 'emprestimo_auto']) await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS ${c}`);
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS emprestimo`);
  }
}
