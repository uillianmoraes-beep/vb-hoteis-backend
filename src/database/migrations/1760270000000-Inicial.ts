import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lote 1 da Fase 1: empresa, ambientes, categorias, motivos de bloqueio,
 * unidades (suíte, quarto, mesa, área) com histórico de status,
 * perfis com permissões e limites, e usuários.
 */
export class Inicial1760270000000 implements MigrationInterface {
  name = 'Inicial1760270000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await q.query(`
      CREATE TABLE empresas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome varchar(150) NOT NULL,
        cnpj varchar(18),
        vocabulario jsonb NOT NULL DEFAULT '{}'::jsonb,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE ambientes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        tipo varchar(20) NOT NULL CHECK (tipo IN ('motel','hotel','pousada','restaurante','bar')),
        cor varchar(9),
        ordem integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_ambientes_empresa ON ambientes(empresa_id)`);

    await q.query(`
      CREATE TABLE categorias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        descricao text,
        tipo_unidade varchar(20) NOT NULL DEFAULT 'suite'
          CHECK (tipo_unidade IN ('suite','quarto','mesa','area')),
        ordem integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_categorias_empresa ON categorias(empresa_id)`);

    await q.query(`
      CREATE TABLE motivos_bloqueio (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        cor varchar(9),
        abre_manutencao boolean NOT NULL DEFAULT false,
        ordem integer NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_motivos_empresa ON motivos_bloqueio(empresa_id)`);

    await q.query(`
      CREATE TABLE unidades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL REFERENCES ambientes(id),
        ambiente_padrao_id uuid NOT NULL REFERENCES ambientes(id),
        categoria_id uuid REFERENCES categorias(id) ON DELETE SET NULL,
        codigo varchar(20) NOT NULL,
        nome varchar(80),
        tipo varchar(20) NOT NULL DEFAULT 'suite'
          CHECK (tipo IN ('suite','quarto','mesa','area')),
        andar varchar(20),
        garagem varchar(20),
        capacidade integer NOT NULL DEFAULT 2,
        status varchar(20) NOT NULL DEFAULT 'livre'
          CHECK (status IN ('livre','ocupada','conta_entregue','limpeza','vistoria','bloqueada','reservada')),
        status_desde timestamptz NOT NULL DEFAULT now(),
        motivo_bloqueio_id uuid REFERENCES motivos_bloqueio(id) ON DELETE SET NULL,
        observacao_status text,
        ordem integer NOT NULL DEFAULT 0,
        planta_x numeric(8,2),
        planta_y numeric(8,2),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_unidades_codigo UNIQUE (empresa_id, codigo)
      )`);
    await q.query(`CREATE INDEX idx_unidades_ambiente ON unidades(ambiente_id)`);

    await q.query(`
      CREATE TABLE unidade_eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        unidade_id uuid NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
        status_anterior varchar(20),
        status_novo varchar(20) NOT NULL,
        motivo_bloqueio_id uuid REFERENCES motivos_bloqueio(id) ON DELETE SET NULL,
        observacao text,
        usuario_id uuid,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_eventos_unidade ON unidade_eventos(unidade_id, criado_em DESC)`);

    await q.query(`
      CREATE TABLE perfis (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(60) NOT NULL,
        descricao text,
        permissoes jsonb NOT NULL DEFAULT '[]'::jsonb,
        limites jsonb NOT NULL DEFAULT '{}'::jsonb,
        sistema boolean NOT NULL DEFAULT false,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_perfis_nome UNIQUE (empresa_id, nome)
      )`);

    await q.query(`
      CREATE TABLE usuarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        perfil_id uuid NOT NULL REFERENCES perfis(id),
        nome varchar(120) NOT NULL,
        login varchar(120) NOT NULL,
        senha_hash varchar(100) NOT NULL,
        ambientes_ids uuid[],
        ativo boolean NOT NULL DEFAULT true,
        ultimo_acesso timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX uq_usuarios_login ON usuarios (lower(login))`);
    await q.query(`CREATE INDEX idx_usuarios_empresa ON usuarios(empresa_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS usuarios`);
    await q.query(`DROP TABLE IF EXISTS perfis`);
    await q.query(`DROP TABLE IF EXISTS unidade_eventos`);
    await q.query(`DROP TABLE IF EXISTS unidades`);
    await q.query(`DROP TABLE IF EXISTS motivos_bloqueio`);
    await q.query(`DROP TABLE IF EXISTS categorias`);
    await q.query(`DROP TABLE IF EXISTS ambientes`);
    await q.query(`DROP TABLE IF EXISTS empresas`);
  }
}
