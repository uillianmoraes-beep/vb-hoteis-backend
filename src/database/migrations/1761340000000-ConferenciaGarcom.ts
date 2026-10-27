import { MigrationInterface, QueryRunner } from 'typeorm';

/** Conferência do garçom por turno: quais itens da geladeira entram (grupos, itens a mais e itens tirados). */
export class ConferenciaGarcom1761340000000 implements MigrationInterface {
  name = 'ConferenciaGarcom1761340000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_conferencia jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_conferencia`);
  }
}
