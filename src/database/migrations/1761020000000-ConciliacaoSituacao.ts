import { MigrationInterface, QueryRunner } from 'typeorm';

/** O motivo da conferência ("sem código: mesmo valor e horário"…) não cabia em 30 letras. */
export class ConciliacaoSituacao1761020000000 implements MigrationInterface {
  name = 'ConciliacaoSituacao1761020000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE conciliacao_linhas ALTER COLUMN situacao TYPE varchar(120)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE conciliacao_linhas ALTER COLUMN situacao TYPE varchar(120)`);
  }
}
