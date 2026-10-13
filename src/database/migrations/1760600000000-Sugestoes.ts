import { MigrationInterface, QueryRunner } from 'typeorm';

/** Canal de sugestões e problemas dos clientes para a Virtual Barra. */
export class Sugestoes1760600000000 implements MigrationInterface {
  name = 'Sugestoes1760600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS sugestoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id uuid,
        usuario_nome varchar(120),
        tipo varchar(10) NOT NULL DEFAULT 'melhoria' CHECK (tipo IN ('melhoria','problema','duvida')),
        area varchar(40),
        tela varchar(120),
        texto varchar(1000) NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'nova' CHECK (status IN ('nova','avaliando','vou_fazer','feito','ja_existe','nao_vale')),
        resposta varchar(600),
        respondido_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_sugestoes_status ON sugestoes(status, criado_em)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS sugestoes`);
  }
}
