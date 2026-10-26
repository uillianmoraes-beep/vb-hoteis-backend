import { MigrationInterface, QueryRunner } from 'typeorm';

/** Avaliação profissional por setor e seleção de pessoal (candidatos, entrevista e prova pelo celular). */
export class AvaliacaoSelecao1761170000000 implements MigrationInterface {
  name = 'AvaliacaoSelecao1761170000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_questionarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        tipo varchar(12) NOT NULL,
        nome varchar(80) NOT NULL,
        setor varchar(20) NOT NULL DEFAULT 'todos',
        perguntas jsonb NOT NULL DEFAULT '[]'::jsonb,
        prova jsonb,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_avaliacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        questionario_id uuid REFERENCES rh_questionarios(id) ON DELETE SET NULL,
        periodo char(7) NOT NULL,
        perguntas_usadas jsonb,
        respostas jsonb NOT NULL DEFAULT '[]'::jsonb,
        nota numeric(4,1),
        pontos_fortes text,
        melhorar text,
        plano text,
        avaliador_nome varchar(120),
        ciente_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (funcionario_id, periodo)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_candidatos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(120) NOT NULL,
        telefone varchar(30),
        email varchar(160),
        setor varchar(20) NOT NULL DEFAULT 'outro',
        vaga varchar(80),
        origem varchar(80),
        observacao varchar(500),
        status varchar(12) NOT NULL DEFAULT 'novo',
        funcionario_id uuid REFERENCES funcionarios(id) ON DELETE SET NULL,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_entrevistas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        candidato_id uuid NOT NULL REFERENCES rh_candidatos(id) ON DELETE CASCADE,
        questionario_id uuid REFERENCES rh_questionarios(id) ON DELETE SET NULL,
        perguntas_usadas jsonb,
        respostas jsonb NOT NULL DEFAULT '[]'::jsonb,
        nota_entrevista numeric(4,1),
        prova_acertos int,
        prova_total int,
        parecer text,
        resultado varchar(10),
        entrevistador_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_provas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        candidato_id uuid NOT NULL REFERENCES rh_candidatos(id) ON DELETE CASCADE,
        questionario_id uuid REFERENCES rh_questionarios(id) ON DELETE SET NULL,
        token varchar(40) NOT NULL UNIQUE,
        questoes jsonb NOT NULL,
        respostas jsonb,
        acertos int,
        total int NOT NULL,
        expira_em timestamptz NOT NULL,
        respondida_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['rh_provas', 'rh_entrevistas', 'rh_candidatos', 'rh_avaliacoes', 'rh_questionarios']) await q.query(`DROP TABLE IF EXISTS ${t}`);
  }
}
