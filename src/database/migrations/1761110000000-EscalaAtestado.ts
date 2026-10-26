import { MigrationInterface, QueryRunner } from 'typeorm';

/** Escala: o atestado (PDF ou foto) anexado no dia da falta fica ligado ao documento do funcionário. */
export class EscalaAtestado1761110000000 implements MigrationInterface {
  name = 'EscalaAtestado1761110000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE escala_dias ADD COLUMN IF NOT EXISTS documento_id uuid REFERENCES funcionario_documentos(id) ON DELETE SET NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE escala_dias DROP COLUMN IF EXISTS documento_id`);
  }
}
