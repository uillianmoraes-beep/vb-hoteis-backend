import { MigrationInterface, QueryRunner } from 'typeorm';

/** Aniversariantes do mês: nascimento do funcionário e as mensagens prontas (hóspede e equipe). */
export class Aniversariantes1761040000000 implements MigrationInterface {
  name = 'Aniversariantes1761040000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS nascimento date`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_aniversario jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_aniversario`);
    await q.query(`ALTER TABLE funcionarios DROP COLUMN IF EXISTS nascimento`);
  }
}
