import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vistoriadoras / Revisões: vistoria de suítes e quartos com fotos obrigatórias (por ambiente),
 * checklist, resultado (aprovado, com ressalva, reprovado), conferência do frigobar e avaria;
 * piscinas e hidros (pH, cloro, produtos usados). As fotos ficam em arquivo na pasta do servidor
 * (VB_FOTOS_DIR); o banco guarda só o caminho.
 */
export class Vistorias1760790000000 implements MigrationInterface {
  name = 'Vistorias1760790000000';

  public async up(q: QueryRunner): Promise<void> {
    // checklist, fotos obrigatórias e avisos de cada ambiente
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS config_vistoria jsonb NOT NULL DEFAULT '{}'::jsonb`);
    // por quanto tempo as fotos ficam guardadas
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fotos_dias integer NOT NULL DEFAULT 180`);
    // resumo da última vistoria na própria unidade (selo no Painel)
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS vistoria_resultado varchar(10)`);
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS vistoria_em timestamptz`);
    await q.query(`ALTER TABLE unidades ADD COLUMN IF NOT EXISTS frigobar_validade date`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS fotos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        origem varchar(12) NOT NULL,
        referencia_id uuid,
        local varchar(60),
        arquivo varchar(200) NOT NULL,
        miniatura varchar(200),
        bytes integer NOT NULL DEFAULT 0,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_fotos_ref ON fotos (referencia_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_fotos_empresa ON fotos (empresa_id, criado_em)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS vistorias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        unidade_id uuid NOT NULL,
        unidade_codigo varchar(20),
        camareira_id uuid,
        camareira_nome varchar(120),
        vistoriadora_id uuid,
        vistoriadora_nome varchar(120) NOT NULL,
        resultado varchar(10) NOT NULL CHECK (resultado IN ('aprovado','ressalva','reprovado')),
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        reposicao jsonb NOT NULL DEFAULT '[]'::jsonb,
        frigobar_validade date,
        avaria text,
        observacao varchar(1000),
        chamado_id uuid,
        decisao varchar(12),
        decisao_motivo varchar(300),
        decidido_por varchar(120),
        decidido_em timestamptz,
        ciente_por varchar(120),
        ciente_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_vistorias ON vistorias (empresa_id, criado_em DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_vistorias_unidade ON vistorias (unidade_id, criado_em DESC)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS agua_locais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        unidade_id uuid,
        nome varchar(80) NOT NULL,
        tipo varchar(12) NOT NULL DEFAULT 'piscina',
        ph_min numeric(4,2) NOT NULL DEFAULT 7.2,
        ph_max numeric(4,2) NOT NULL DEFAULT 7.6,
        cloro_min numeric(5,2) NOT NULL DEFAULT 1,
        cloro_max numeric(5,2) NOT NULL DEFAULT 3,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS agua_registros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        local_id uuid NOT NULL REFERENCES agua_locais(id) ON DELETE CASCADE,
        ph numeric(4,2),
        cloro numeric(5,2),
        alcalinidade numeric(6,1),
        temperatura numeric(4,1),
        acoes jsonb NOT NULL DEFAULT '[]'::jsonb,
        produtos jsonb NOT NULL DEFAULT '[]'::jsonb,
        fora_da_faixa boolean NOT NULL DEFAULT false,
        observacao varchar(1000),
        usuario_id uuid,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_agua_registros ON agua_registros (empresa_id, criado_em DESC)`);

    // quem já cuida da limpeza e da gerência ganha as permissões novas
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["vistorias.fazer"]'::jsonb
                    WHERE nome IN ('Revisora','Supervisor da limpeza','Gerente') AND NOT permissoes ? 'vistorias.fazer'`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["vistorias.decidir","vistorias.configurar","vistorias.relatorio","piscinas.registrar"]'::jsonb
                    WHERE nome = 'Gerente' AND NOT permissoes ? 'vistorias.decidir'`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["vistorias.relatorio"]'::jsonb
                    WHERE nome = 'Supervisor da limpeza' AND NOT permissoes ? 'vistorias.relatorio'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS agua_registros`);
    await q.query(`DROP TABLE IF EXISTS agua_locais`);
    await q.query(`DROP TABLE IF EXISTS vistorias`);
    await q.query(`DROP TABLE IF EXISTS fotos`);
    for (const c of ['vistoria_resultado', 'vistoria_em', 'frigobar_validade']) await q.query(`ALTER TABLE unidades DROP COLUMN IF EXISTS ${c}`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS fotos_dias`);
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS config_vistoria`);
  }
}
