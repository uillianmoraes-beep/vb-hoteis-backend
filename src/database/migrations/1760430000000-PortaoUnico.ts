import { MigrationInterface, QueryRunner } from 'typeorm';

/** Ambiente com entrada e saída pelo mesmo portão: a portaria registra a saída no próprio painel. */
export class PortaoUnico1760430000000 implements MigrationInterface {
  name = 'PortaoUnico1760430000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS portao_unico boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS portao_unico`);
  }
}
