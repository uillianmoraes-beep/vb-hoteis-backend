import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Atendente de vendas com IA no site: cada conversa fica guardada (para o dono ler e acompanhar),
 * com o contato do interessado quando ele deixa (vira lead no painel da revenda).
 */
export class VendasIa1761520000000 implements MigrationInterface {
  name = 'VendasIa1761520000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS vendas_conversas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        mensagens jsonb NOT NULL DEFAULT '[]'::jsonb,
        nome varchar(120),
        telefone varchar(20),
        email varchar(120),
        negocio varchar(200),
        parceiro varchar(20),
        ip varchar(60),
        lido boolean NOT NULL DEFAULT false,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_vendas_conversas_data ON vendas_conversas (atualizado_em DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS vendas_conversas`);
  }
}
