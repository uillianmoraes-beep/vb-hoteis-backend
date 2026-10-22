import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plano de contas (linhas da DRE e do fluxo de caixa), ligação das categorias de texto já usadas
 * em despesas e caixa, contas bancárias e maquininhas com taxas e prazos de recebimento.
 */
export class PlanoContasMaquininhas1760940000000 implements MigrationInterface {
  name = 'PlanoContasMaquininhas1760940000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS plano_contas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        grupo varchar(20) NOT NULL,
        nome varchar(60) NOT NULL,
        ordem int NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_plano_contas_nome ON plano_contas (empresa_id, lower(nome))`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS plano_contas_categorias (
        empresa_id uuid NOT NULL,
        categoria varchar(60) NOT NULL,
        conta_id uuid NOT NULL REFERENCES plano_contas(id) ON DELETE CASCADE,
        PRIMARY KEY (empresa_id, categoria)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS contas_bancarias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(60) NOT NULL,
        banco varchar(60),
        agencia varchar(10),
        conta varchar(20),
        chave_pix varchar(120),
        cnpj varchar(14),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS maquininhas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(40) NOT NULL,
        adquirente varchar(30),
        conta_bancaria_id uuid REFERENCES contas_bancarias(id) ON DELETE SET NULL,
        taxa_debito numeric(6,3),
        taxa_credito numeric(6,3),
        taxa_credito_2a6 numeric(6,3),
        taxa_credito_7a12 numeric(6,3),
        taxa_pix numeric(6,3),
        prazo_debito int NOT NULL DEFAULT 1,
        prazo_credito int NOT NULL DEFAULT 30,
        prazo_pix int NOT NULL DEFAULT 0,
        antecipacao boolean NOT NULL DEFAULT false,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_maquininhas_nome ON maquininhas (empresa_id, lower(nome))`);
    // as maquininhas já digitadas em Caixa › Categorias e maquininhas viram cadastro
    await q.query(`
      INSERT INTO maquininhas (empresa_id, nome)
      SELECT e.id, left(trim(m.nome), 40) FROM empresas e, jsonb_array_elements_text(COALESCE(e.config_caixa->'maquininhas', '[]'::jsonb)) AS m(nome)
       WHERE trim(m.nome) <> ''
      ON CONFLICT DO NOTHING`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS maquininhas`);
    await q.query(`DROP TABLE IF EXISTS contas_bancarias`);
    await q.query(`DROP TABLE IF EXISTS plano_contas_categorias`);
    await q.query(`DROP TABLE IF EXISTS plano_contas`);
  }
}
