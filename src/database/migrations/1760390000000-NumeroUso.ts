import { MigrationInterface, QueryRunner } from 'typeorm';

/** Número do uso (comanda): sequência simples por empresa, para relatórios e conferência. */
export class NumeroUso1760390000000 implements MigrationInterface {
  name = 'NumeroUso1760390000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS numero integer`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_uso integer NOT NULL DEFAULT 0`);
    await q.query(`
      UPDATE estadias e SET numero = r.n
      FROM (SELECT id, row_number() OVER (PARTITION BY empresa_id ORDER BY entrada_em, id) AS n FROM estadias) r
      WHERE e.id = r.id AND e.numero IS NULL`);
    await q.query(`UPDATE empresas SET ultimo_uso = COALESCE((SELECT MAX(numero) FROM estadias WHERE estadias.empresa_id = empresas.id), 0)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_estadias_numero ON estadias(empresa_id, numero) WHERE numero IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS uq_estadias_numero`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS numero`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS ultimo_uso`);
  }
}
