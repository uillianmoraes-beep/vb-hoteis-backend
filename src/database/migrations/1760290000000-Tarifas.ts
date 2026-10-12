import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lote 3: períodos (por ambiente, opcionalmente só para algumas categorias),
 * tabelas de preço (dias, horário e datas especiais, com troca de preço e de
 * duração), estadias (entradas) e regras de cobrança por ambiente. Cria o padrão 4h/6h/12h/pernoite
 * nos ambientes de motel que já existem.
 */
export class Tarifas1760290000000 implements MigrationInterface {
  name = 'Tarifas1760290000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS regras jsonb NOT NULL DEFAULT '{}'::jsonb`);

    await q.query(`
      CREATE TABLE periodos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL REFERENCES ambientes(id) ON DELETE CASCADE,
        nome varchar(40) NOT NULL,
        tipo varchar(10) NOT NULL CHECK (tipo IN ('horas','pernoite')),
        duracao_min integer,
        pernoite_inicio varchar(5),
        pernoite_fim varchar(5),
        categoria_ids uuid[],
        ordem integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_periodos_ambiente ON periodos(ambiente_id)`);

    await q.query(`
      CREATE TABLE tabelas_preco (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL REFERENCES ambientes(id) ON DELETE CASCADE,
        nome varchar(60) NOT NULL,
        dias_semana integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
        hora_inicio varchar(5),
        hora_fim varchar(5),
        data_inicio date,
        data_fim date,
        prioridade integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_tabelas_ambiente ON tabelas_preco(ambiente_id)`);

    await q.query(`
      CREATE TABLE precos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tabela_id uuid NOT NULL REFERENCES tabelas_preco(id) ON DELETE CASCADE,
        categoria_id uuid NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
        tipo varchar(20) NOT NULL CHECK (tipo IN ('periodo','hora_adicional','pessoa_adicional')),
        periodo_id uuid REFERENCES periodos(id) ON DELETE CASCADE,
        valor numeric(10,2) NOT NULL DEFAULT 0,
        duracao_min integer
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_precos ON precos (tabela_id, categoria_id, tipo, COALESCE(periodo_id, '00000000-0000-0000-0000-000000000000'::uuid))`);

    await q.query(`
      CREATE TABLE estadias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL REFERENCES ambientes(id),
        unidade_id uuid NOT NULL REFERENCES unidades(id),
        categoria_id uuid REFERENCES categorias(id) ON DELETE SET NULL,
        tabela_id uuid REFERENCES tabelas_preco(id) ON DELETE SET NULL,
        modalidade varchar(10) NOT NULL DEFAULT 'periodo' CHECK (modalidade IN ('periodo','pernoite')),
        placa varchar(10),
        pessoas integer NOT NULL DEFAULT 2,
        observacao text,
        status varchar(16) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','conta_entregue','fechada','cancelada')),
        entrada_em timestamptz NOT NULL DEFAULT now(),
        conta_entregue_em timestamptz,
        pausado_min integer NOT NULL DEFAULT 0,
        saida_em timestamptz,
        periodo_nome varchar(60),
        valor_hospedagem numeric(10,2),
        valor_pessoas numeric(10,2),
        desconto numeric(10,2) NOT NULL DEFAULT 0,
        acrescimo numeric(10,2) NOT NULL DEFAULT 0,
        valor_total numeric(10,2),
        forma_pagamento varchar(20),
        motivo_ajuste text,
        autorizado_por varchar(120),
        usuario_entrada_id uuid,
        usuario_entrada_nome varchar(120),
        usuario_saida_id uuid,
        usuario_saida_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_estadias_unidade ON estadias(unidade_id, status)`);
    await q.query(`CREATE INDEX idx_estadias_empresa_data ON estadias(empresa_id, entrada_em DESC)`);
    await q.query(`CREATE UNIQUE INDEX uq_estadia_aberta ON estadias(unidade_id) WHERE status IN ('aberta','conta_entregue')`);

    // Padrão nos motéis que já existem: 4h, 6h, 12h e pernoite 22h–12h, tabela "Todos os dias" sem preço
    await q.query(`UPDATE ambientes SET regras = '{"toleranciaMin":15,"aposUltimo":"hora_adicional","pessoasIncluidas":2}'::jsonb WHERE tipo = 'motel' AND regras = '{}'::jsonb`);
    await q.query(`
      INSERT INTO periodos (empresa_id, ambiente_id, nome, tipo, duracao_min, pernoite_inicio, pernoite_fim, ordem)
      SELECT a.empresa_id, a.id, v.nome, v.tipo, v.dur, v.ini, v.fim, v.ordem
      FROM ambientes a
      CROSS JOIN (VALUES
        ('4 horas', 'horas', 240, NULL, NULL, 1),
        ('6 horas', 'horas', 360, NULL, NULL, 2),
        ('12 horas', 'horas', 720, NULL, NULL, 3),
        ('Pernoite', 'pernoite', NULL, '22:00', '12:00', 4)
      ) AS v(nome, tipo, dur, ini, fim, ordem)
      WHERE a.tipo = 'motel'`);
    await q.query(`
      INSERT INTO tabelas_preco (empresa_id, ambiente_id, nome, prioridade)
      SELECT empresa_id, id, 'Todos os dias', 0 FROM ambientes WHERE tipo = 'motel'`);

    // Permissões novas nos perfis padrão
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["tarifas.gerenciar","estadias.operar","estadias.cancelar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'estadias.operar'`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["estadias.operar"]'::jsonb WHERE nome = 'Recepção' AND NOT permissoes ? 'estadias.operar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS estadias`);
    await q.query(`DROP TABLE IF EXISTS precos`);
    await q.query(`DROP TABLE IF EXISTS tabelas_preco`);
    await q.query(`DROP TABLE IF EXISTS periodos`);
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS regras`);
  }
}
