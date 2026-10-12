import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pesquisa de satisfação: QR na conta (1 por estadia) e respostas. */
export class Satisfacao1760380000000 implements MigrationInterface {
  name = 'Satisfacao1760380000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS avaliacao_token varchar(16)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_estadias_avaliacao_token ON estadias(avaliacao_token) WHERE avaliacao_token IS NOT NULL`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid NOT NULL UNIQUE REFERENCES estadias(id) ON DELETE CASCADE,
        unidade_id uuid,
        ambiente_id uuid,
        limpeza smallint CHECK (limpeza BETWEEN 1 AND 5),
        atendimento smallint CHECK (atendimento BETWEEN 1 AND 5),
        conforto smallint CHECK (conforto BETWEEN 1 AND 5),
        consumo smallint CHECK (consumo BETWEEN 1 AND 5),
        geral numeric(3,2) NOT NULL,
        voltaria boolean,
        comentario text,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_avaliacoes_empresa_data ON avaliacoes(empresa_id, criado_em)`);
    // empresas de demonstração (com outros módulos liberados) ganham este também
    await q.query(`UPDATE empresas SET modulos = modulos || '{"satisfacao":true}'::jsonb WHERE (modulos->>'notas')::boolean IS TRUE`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["avaliacoes.ver"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'avaliacoes.ver'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS avaliacoes`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS avaliacao_token`);
  }
}
