import { MigrationInterface, QueryRunner } from 'typeorm';

/** Contratos com clientes e fornecedores: modelos de cláusulas, versões/aditivos com assinatura pelo link e cobranças mensais. */
export class Contratos1761190000000 implements MigrationInterface {
  name = 'Contratos1761190000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS contrato_modelos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        tipo varchar(15) NOT NULL,
        area varchar(20),
        titulo varchar(150) NOT NULL,
        texto text NOT NULL,
        ordem int NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS contratos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        numero int NOT NULL,
        lado varchar(12) NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'rascunho',
        parte jsonb NOT NULL,
        cliente_faturado_id uuid,
        conta_pagar_id uuid,
        versao_vigente int,
        encerrado_em timestamptz,
        motivo_encerramento varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, numero)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS contrato_versoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        contrato_id uuid NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
        numero int NOT NULL,
        tipo varchar(10) NOT NULL,
        alteracao text,
        servicos jsonb NOT NULL,
        valor_mensal numeric(14,2) NOT NULL DEFAULT 0,
        inicio date NOT NULL,
        vigencia_meses int NOT NULL,
        dia_vencimento int NOT NULL,
        forma_pagamento varchar(15) NOT NULL,
        texto text NOT NULL,
        texto_final text,
        hash char(64),
        token varchar(64) UNIQUE,
        status varchar(12) NOT NULL DEFAULT 'rascunho',
        enviado_em timestamptz,
        assinatura_parte jsonb,
        assinatura_hotel jsonb,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (contrato_id, numero)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS contrato_cobrancas (
        contrato_id uuid NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
        competencia char(7) NOT NULL,
        referencia_id uuid,
        valor numeric(14,2) NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (contrato_id, competencia)
      )`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["contratos.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'contratos.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['contrato_cobrancas', 'contrato_versoes', 'contratos', 'contrato_modelos']) await q.query(`DROP TABLE IF EXISTS ${t}`);
  }
}
