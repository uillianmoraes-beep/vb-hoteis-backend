import { MigrationInterface, QueryRunner } from 'typeorm';

/** Valor combinado da reserva na conta, café da manhã (composição, listas, sobras) e faturamento (clientes, a receber, faturas, créditos). */
export class CafeFaturamento1760560000000 implements MigrationInterface {
  name = 'CafeFaturamento1760560000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS diaria_combinada numeric(10,2)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS total_combinado numeric(10,2)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS saida_prevista date`);

    /* ---------- café da manhã ---------- */
    await q.query(`
      CREATE TABLE IF NOT EXISTS cafe_itens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        grupo varchar(40),
        unidade varchar(12) NOT NULL DEFAULT 'un',
        por_pessoa numeric(10,4) NOT NULL DEFAULT 0 CHECK (por_pessoa >= 0),
        passo numeric(10,3) NOT NULL DEFAULT 1 CHECK (passo > 0),
        reaproveita boolean NOT NULL DEFAULT true,
        sobra numeric(12,3) NOT NULL DEFAULT 0 CHECK (sobra >= 0),
        ordem integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cafe_itens_empresa ON cafe_itens(empresa_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cafe_listas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        data date NOT NULL,
        hospedados integer NOT NULL DEFAULT 0,
        chegando integer NOT NULL DEFAULT 0,
        ajuste integer NOT NULL DEFAULT 0,
        total integer NOT NULL DEFAULT 0,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        status varchar(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','fechada')),
        observacao varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        fechado_por varchar(120),
        fechado_em timestamptz,
        UNIQUE (empresa_id, data)
      )`);

    /* ---------- faturamento ---------- */
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultima_fatura integer NOT NULL DEFAULT 0`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS clientes_faturados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(120) NOT NULL,
        documento varchar(20),
        contato varchar(120),
        telefone varchar(30),
        email varchar(120),
        endereco varchar(250),
        prazo_dias integer NOT NULL DEFAULT 30,
        limite numeric(12,2),
        observacao varchar(300),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS faturas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero integer,
        cliente_id uuid NOT NULL REFERENCES clientes_faturados(id),
        emissao date NOT NULL,
        vencimento date NOT NULL,
        valor numeric(12,2) NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
        boleto_linha varchar(80),
        boleto_nosso_numero varchar(40),
        boleto_link varchar(300),
        observacao varchar(300),
        pago_em date,
        valor_pago numeric(12,2),
        forma_pagamento varchar(20),
        pago_por varchar(120),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS contas_receber (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id uuid REFERENCES clientes_faturados(id),
        estadia_id uuid,
        fatura_id uuid REFERENCES faturas(id),
        descricao varchar(250) NOT NULL,
        valor numeric(12,2) NOT NULL CHECK (valor > 0),
        vencimento date NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
        pago_em date,
        forma_pagamento varchar(20),
        pago_por varchar(120),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_receber_cliente ON contas_receber(empresa_id, cliente_id, status)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS clientes_creditos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cliente_id uuid NOT NULL REFERENCES clientes_faturados(id),
        tipo varchar(10) NOT NULL CHECK (tipo IN ('entrada','uso','devolucao')),
        valor numeric(12,2) NOT NULL CHECK (valor > 0),
        forma varchar(20),
        descricao varchar(250),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_creditos_cliente ON clientes_creditos(empresa_id, cliente_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['clientes_creditos', 'contas_receber', 'faturas', 'clientes_faturados', 'cafe_listas', 'cafe_itens']) await q.query(`DROP TABLE IF EXISTS ${t}`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS ultima_fatura`);
    for (const c of ['diaria_combinada', 'total_combinado', 'saida_prevista']) await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS ${c}`);
  }
}
