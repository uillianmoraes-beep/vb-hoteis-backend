import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Produção e cortes (porcionamento): uma matéria-prima (peça de contra filé, frango inteiro) sai do estoque
 * e entram as porções (bife de 380 g, filé de peito, frango a passarinho, desfiado), com o custo dividido pelo peso.
 * O modelo guarda a perda esperada e quanto do aproveitado vai para cada saída; o lançamento guarda o real.
 */
export class Cortes1760840000000 implements MigrationInterface {
  name = 'Cortes1760840000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS cortes_modelos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(80) NOT NULL,
        materia_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        perda_pct numeric(5,2) NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cortes_modelo_saidas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        modelo_id uuid NOT NULL REFERENCES cortes_modelos(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
        percentual numeric(5,2) NOT NULL,
        peso_porcao numeric(10,3),
        ordem int NOT NULL DEFAULT 0
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS cortes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero int NOT NULL,
        modelo_id uuid,
        local_id uuid NOT NULL,
        materia_id uuid NOT NULL,
        quantidade numeric(14,3) NOT NULL,
        peso_kg numeric(14,3) NOT NULL,
        aproveitado_kg numeric(14,3) NOT NULL,
        esperado_pct numeric(5,2),
        custo_total numeric(14,2) NOT NULL,
        fornecedor varchar(120),
        observacao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_cortes_empresa ON cortes(empresa_id, criado_em)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS corte_itens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        corte_id uuid NOT NULL REFERENCES cortes(id) ON DELETE CASCADE,
        produto_id uuid NOT NULL,
        quantidade numeric(14,3) NOT NULL,
        peso_kg numeric(14,3) NOT NULL,
        esperado numeric(14,3),
        custo_unitario numeric(14,4) NOT NULL
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS corte_itens`);
    await q.query(`DROP TABLE IF EXISTS cortes`);
    await q.query(`DROP TABLE IF EXISTS cortes_modelo_saidas`);
    await q.query(`DROP TABLE IF EXISTS cortes_modelos`);
  }
}
