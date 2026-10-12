import { MigrationInterface, QueryRunner } from 'typeorm';

/** Perguntas da pesquisa definidas pela empresa; respostas guardadas por pergunta. */
export class PerguntasPesquisa1760400000000 implements MigrationInterface {
  name = 'PerguntasPesquisa1760400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS pesquisa jsonb`);
    await q.query(`ALTER TABLE avaliacoes ADD COLUMN IF NOT EXISTS respostas jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      UPDATE avaliacoes SET respostas = jsonb_strip_nulls(jsonb_build_object(
        'limpeza', limpeza, 'atendimento', atendimento, 'conforto', conforto, 'frigobar', consumo))
      WHERE respostas = '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE avaliacoes DROP COLUMN IF EXISTS respostas`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS pesquisa`);
  }
}
