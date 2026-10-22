import { MigrationInterface, QueryRunner } from 'typeorm';

/** Devolução ao estoque (estorno) fica avisando o estoquista até ele conferir que a mercadoria voltou mesmo. */
export class ConferirDevolucoes1760970000000 implements MigrationInterface {
  name = 'ConferirDevolucoes1760970000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS conferido_em timestamptz`);
    await q.query(`ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS conferido_por varchar(120)`);
    // o que já voltou antes desta versão não fica pendente
    await q.query(`UPDATE estoque_movimentos SET conferido_em = criado_em, conferido_por = 'antes do aviso' WHERE tipo = 'estorno' AND conferido_em IS NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estoque_mov_conferir ON estoque_movimentos (empresa_id) WHERE tipo = 'estorno' AND conferido_em IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_estoque_mov_conferir`);
    await q.query(`ALTER TABLE estoque_movimentos DROP COLUMN IF EXISTS conferido_por`);
    await q.query(`ALTER TABLE estoque_movimentos DROP COLUMN IF EXISTS conferido_em`);
  }
}
