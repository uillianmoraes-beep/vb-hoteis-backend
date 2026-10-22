import { MigrationInterface, QueryRunner } from 'typeorm';

/** +10 min para a camareira: tempo extra da situação atual da suíte (vale enquanto a situação não muda). */
export class TempoExtraCamareira1761030000000 implements MigrationInterface {
  name = 'TempoExtraCamareira1761030000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS tempo_extra_min int NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS tempo_extra_desde timestamptz`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_unidade_eventos_tempo ON unidade_eventos (empresa_id, criado_em)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_unidade_eventos_tempo`);
    await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS tempo_extra_desde`);
    await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS tempo_extra_min`);
  }
}
