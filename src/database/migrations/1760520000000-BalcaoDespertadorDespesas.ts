import { MigrationInterface, QueryRunner } from 'typeorm';

/** Venda avulsa (fora da conta), despertador de hóspedes e contas a pagar (despesas). */
export class BalcaoDespertadorDespesas1760520000000 implements MigrationInterface {
  name = 'BalcaoDespertadorDespesas1760520000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS vendas_avulsas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL,
        turno_id uuid REFERENCES caixa_turnos(id) ON DELETE SET NULL,
        para varchar(12) NOT NULL DEFAULT 'cliente' CHECK (para IN ('cliente','funcionario')),
        funcionario_id uuid,
        funcionario_nome varchar(120),
        itens jsonb NOT NULL,
        total numeric(10,2) NOT NULL,
        forma varchar(20) NOT NULL,
        valor_recebido numeric(10,2),
        troco numeric(10,2) NOT NULL DEFAULT 0,
        cancelada boolean NOT NULL DEFAULT false,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_vendas_avulsas_turno ON vendas_avulsas(turno_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS despertadores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        unidade_id uuid NOT NULL,
        estadia_id uuid,
        horario timestamptz NOT NULL,
        observacao varchar(200),
        status varchar(10) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','feito','cancelado')),
        criado_por varchar(120),
        feito_por varchar(120),
        feito_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_despertadores_pend ON despertadores(empresa_id, horario) WHERE status = 'pendente'`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS contas_pagar (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        descricao varchar(200) NOT NULL,
        fornecedor varchar(120),
        categoria varchar(60),
        valor numeric(12,2) NOT NULL CHECK (valor > 0),
        vencimento date NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
        recorrente varchar(10) NOT NULL DEFAULT 'nao' CHECK (recorrente IN ('nao','mensal')),
        pago_em date,
        valor_pago numeric(12,2),
        forma_pagamento varchar(20),
        codigo_barras varchar(80),
        observacao varchar(300),
        criado_por varchar(120),
        pago_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_contas_pagar ON contas_pagar(empresa_id, status, vencimento)`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["despesas.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'despesas.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS contas_pagar`);
    await q.query(`DROP TABLE IF EXISTS despertadores`);
    await q.query(`DROP TABLE IF EXISTS vendas_avulsas`);
  }
}
