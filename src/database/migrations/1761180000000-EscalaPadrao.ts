import { MigrationInterface, QueryRunner } from 'typeorm';

/** Escala padrão de cada funcionário (6x1, 12x36, turno…), escolhida no cadastro: a escala se preenche sozinha. */
export class EscalaPadrao1761180000000 implements MigrationInterface {
  name = 'EscalaPadrao1761180000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS escala_padrao jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE funcionarios DROP COLUMN IF EXISTS escala_padrao`);
  }
}
