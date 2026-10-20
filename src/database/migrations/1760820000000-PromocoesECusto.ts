import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarifas inteligentes: promoções dos dias fracos. No motel a promoção cria uma tabela de preço
 * de data especial (ganha das outras no período); no hotel guarda a diária promocional por categoria.
 * O brinde (combo, pizza, café…) entra sozinho na conta na entrada.
 * E o preço de custo do produto (para a margem) quando ainda não há custo pelo estoque.
 */
export class PromocoesECusto1760820000000 implements MigrationInterface {
  name = 'PromocoesECusto1760820000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS promocoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL,
        nome varchar(80) NOT NULL,
        dias_semana int[] NOT NULL,
        hora_inicio varchar(5),
        hora_fim varchar(5),
        data_inicio date NOT NULL,
        data_fim date NOT NULL,
        tabela_id uuid,
        diarias jsonb,
        brinde_produto_id uuid,
        brinde_quantidade numeric(10,3) NOT NULL DEFAULT 1,
        ativo boolean NOT NULL DEFAULT true,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        encerrado_em timestamptz
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_promocoes_ambiente ON promocoes(empresa_id, ambiente_id, ativo)`);
    await q.query(`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS custo numeric(10,2)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE produtos DROP COLUMN IF EXISTS custo`);
    await q.query(`DROP TABLE IF EXISTS promocoes`);
  }
}
