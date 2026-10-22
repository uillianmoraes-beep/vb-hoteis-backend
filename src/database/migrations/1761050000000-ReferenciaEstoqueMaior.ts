import { MigrationInterface, QueryRunner } from 'typeorm';

/** A referência da entrada por cotação (cotacao:<id>:<fornecedor>) passava de 60 letras e travava "Dar entrada no estoque". */
export class ReferenciaEstoqueMaior1761050000000 implements MigrationInterface {
  name = 'ReferenciaEstoqueMaior1761050000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estoque_movimentos ALTER COLUMN referencia TYPE varchar(120)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estoque_movimentos ALTER COLUMN referencia TYPE varchar(120)`);
  }
}
