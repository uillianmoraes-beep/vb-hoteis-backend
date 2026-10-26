import { MigrationInterface, QueryRunner } from 'typeorm';

/** Guarda em cada fechamento de caixa qual ajuda estava ligada (o gerente vê no relatório). */
export class AjudaFechamentoCaixa1761330000000 implements MigrationInterface {
  name = 'AjudaFechamentoCaixa1761330000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE caixa_turnos ADD COLUMN IF NOT EXISTS ajuda_fechamento varchar(10)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE caixa_turnos DROP COLUMN IF EXISTS ajuda_fechamento`);
  }
}
