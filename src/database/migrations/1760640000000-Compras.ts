import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Compras: cadastro de fornecedores (distribuidores) e cotações. Cada fornecedor
 * recebe um link para informar os preços; o sistema compara e gera o pedido de compra.
 */
export class Compras1760640000000 implements MigrationInterface {
  name = 'Compras1760640000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS fornecedores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(120) NOT NULL,
        cnpj varchar(14),
        contato varchar(80),
        telefone varchar(20),
        email varchar(120),
        categorias varchar(200),
        observacao varchar(300),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cotacoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero integer NOT NULL,
        titulo varchar(120) NOT NULL,
        local_id uuid,
        prazo date,
        observacao varchar(500),
        status varchar(12) NOT NULL DEFAULT 'aberta',
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        fechada_em timestamptz,
        fechada_por varchar(120)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cotacao_itens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cotacao_id uuid NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
        produto_id uuid,
        descricao varchar(200) NOT NULL,
        quantidade numeric(12,3) NOT NULL,
        unidade varchar(10) NOT NULL DEFAULT 'un',
        ordem integer NOT NULL DEFAULT 0,
        escolhido_id uuid
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cotacao_fornecedores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cotacao_id uuid NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
        fornecedor_id uuid NOT NULL REFERENCES fornecedores(id),
        token varchar(32) NOT NULL UNIQUE,
        status varchar(12) NOT NULL DEFAULT 'convidado',
        respondido_em timestamptz,
        prazo_entrega varchar(60),
        condicao_pagamento varchar(80),
        frete numeric(12,2) NOT NULL DEFAULT 0,
        observacao varchar(500),
        UNIQUE (cotacao_id, fornecedor_id)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cotacao_precos (
        cotacao_fornecedor_id uuid NOT NULL REFERENCES cotacao_fornecedores(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES cotacao_itens(id) ON DELETE CASCADE,
        preco numeric(12,4),
        marca varchar(60),
        PRIMARY KEY (cotacao_fornecedor_id, item_id)
      )`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultima_cotacao integer NOT NULL DEFAULT 0`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["compras.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'compras.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['cotacao_precos', 'cotacao_fornecedores', 'cotacao_itens', 'cotacoes', 'fornecedores']) await q.query(`DROP TABLE IF EXISTS ${t}`);
  }
}
