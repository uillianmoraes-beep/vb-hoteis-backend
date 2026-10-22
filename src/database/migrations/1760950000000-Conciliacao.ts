import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conciliação bancária: arquivos importados (extrato OFX/planilha do banco e relatório da maquininha),
 * cada linha deles e com qual pagamento do sistema ela bateu; modelos de colunas por maquininha.
 */
export class Conciliacao1760950000000 implements MigrationInterface {
  name = 'Conciliacao1760950000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS conciliacao_modelos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        origem varchar(10) NOT NULL,
        maquininha_id uuid,
        conta_bancaria_id uuid,
        assinatura text NOT NULL,
        mapa jsonb NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_conc_modelos ON conciliacao_modelos (empresa_id, assinatura)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS conciliacao_importacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        origem varchar(10) NOT NULL,
        formato varchar(10) NOT NULL,
        maquininha_id uuid,
        conta_bancaria_id uuid,
        arquivo varchar(200),
        de date,
        ate date,
        linhas int NOT NULL DEFAULT 0,
        repetidas int NOT NULL DEFAULT 0,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS conciliacao_linhas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        importacao_id uuid NOT NULL REFERENCES conciliacao_importacoes(id) ON DELETE CASCADE,
        origem varchar(10) NOT NULL,
        maquininha_id uuid,
        conta_bancaria_id uuid,
        chave varchar(120) NOT NULL,
        momento timestamptz NOT NULL,
        tem_hora boolean NOT NULL DEFAULT false,
        data_pagamento date,
        forma varchar(10),
        bandeira varchar(30),
        parcelas smallint,
        nsu varchar(60),
        autorizacao varchar(60),
        valor_bruto numeric(12,2) NOT NULL,
        taxa numeric(12,2),
        valor_liquido numeric(12,2),
        descricao varchar(300),
        status varchar(12) NOT NULL DEFAULT 'pendente',
        situacao varchar(30),
        pagamento_id uuid,
        deposito_de jsonb,
        observacao varchar(300),
        conferido_por varchar(120),
        conferido_em timestamptz
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_conc_linha ON conciliacao_linhas (empresa_id, origem, chave)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_conc_linha_momento ON conciliacao_linhas (empresa_id, momento)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_conc_linha_pag ON conciliacao_linhas (pagamento_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS conciliacao_linhas`);
    await q.query(`DROP TABLE IF EXISTS conciliacao_importacoes`);
    await q.query(`DROP TABLE IF EXISTS conciliacao_modelos`);
  }
}
