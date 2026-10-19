import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Categoria passa a ser de um ambiente (motel, hotel…): mexer nas categorias e tarifas do hotel
 * não muda mais o motel, e vice-versa.
 *
 * Categorias que hoje servem a mais de um ambiente (unidades, preços, diárias ou reserva online
 * em ambientes diferentes) viram uma cópia por ambiente, com tudo o que é daquele ambiente
 * apontando para a cópia. Categoria sem uso fica sem ambiente e aparece em todos até alguém escolher.
 * Categoria desativada que ainda tem unidade ativa volta a ficar ativa (a unidade continua cobrando por ela).
 */
export class CategoriaPorAmbiente1760775000000 implements MigrationInterface {
  name = 'CategoriaPorAmbiente1760775000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE categorias ADD COLUMN IF NOT EXISTS ambiente_id uuid REFERENCES ambientes(id) ON DELETE SET NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_categorias_ambiente ON categorias(ambiente_id)`);
    await q.query(`
      DO $$
      DECLARE
        c record;
        amb uuid;
        primeiro boolean;
        nova uuid;
        k text;
      BEGIN
        FOR c IN SELECT * FROM categorias WHERE ambiente_id IS NULL ORDER BY criado_em LOOP
          k := c.id::text;
          primeiro := true;
          FOR amb IN
            SELECT x.a FROM (
              SELECT ambiente_padrao_id AS a, count(*)::int AS n FROM unidades WHERE categoria_id = c.id GROUP BY ambiente_padrao_id
              UNION ALL
              SELECT t.ambiente_id, 0 FROM precos p JOIN tabelas_preco t ON t.id = p.tabela_id WHERE p.categoria_id = c.id
              UNION ALL
              SELECT id, 0 FROM ambientes WHERE empresa_id = c.empresa_id AND (COALESCE(diarias, '{}'::jsonb) ? k OR COALESCE(reserva_online->'categorias', '{}'::jsonb) ? k)
            ) x JOIN ambientes ab ON ab.id = x.a
            GROUP BY x.a, ab.ordem ORDER BY sum(x.n) DESC, ab.ordem, x.a
          LOOP
            IF primeiro THEN
              UPDATE categorias SET ambiente_id = amb WHERE id = c.id;
              primeiro := false;
            ELSE
              INSERT INTO categorias (empresa_id, nome, descricao, tipo_unidade, ordem, foto, ativo, ambiente_id)
                VALUES (c.empresa_id, c.nome, c.descricao, c.tipo_unidade, c.ordem, c.foto, c.ativo, amb) RETURNING id INTO nova;
              UPDATE unidades SET categoria_id = nova WHERE categoria_id = c.id AND ambiente_padrao_id = amb;
              UPDATE precos p SET categoria_id = nova FROM tabelas_preco t WHERE t.id = p.tabela_id AND t.ambiente_id = amb AND p.categoria_id = c.id;
              UPDATE periodos SET categoria_ids = array_replace(categoria_ids, c.id, nova) WHERE ambiente_id = amb AND c.id = ANY(categoria_ids);
              UPDATE estadias SET categoria_id = nova WHERE categoria_id = c.id AND ambiente_id = amb AND status IN ('aberta','conta_entregue');
              UPDATE ambientes SET diarias = (diarias - k) || jsonb_build_object(nova::text, diarias->k)
                WHERE id = amb AND COALESCE(diarias, '{}'::jsonb) ? k;
              UPDATE ambientes SET reserva_online = jsonb_set(reserva_online, '{categorias}',
                  ((reserva_online->'categorias') - k) || jsonb_build_object(nova::text, reserva_online->'categorias'->k))
                WHERE id = amb AND COALESCE(reserva_online->'categorias', '{}'::jsonb) ? k;
              INSERT INTO frigobar_categoria (empresa_id, categoria_id, produto_id, quantidade)
                SELECT empresa_id, nova, produto_id, quantidade FROM frigobar_categoria WHERE categoria_id = c.id;
              INSERT INTO enxoval_kits (empresa_id, categoria_id, tipo_id, quantidade)
                SELECT empresa_id, nova, tipo_id, quantidade FROM enxoval_kits WHERE categoria_id = c.id;
              UPDATE cortesias SET categoria_ids = categoria_ids || to_jsonb(nova::text) WHERE categoria_ids ? k;
            END IF;
          END LOOP;
        END LOOP;
      END $$`);
    await q.query(`
      UPDATE categorias c SET ativo = true, atualizado_em = now()
       WHERE c.ativo = false AND EXISTS (SELECT 1 FROM unidades un WHERE un.categoria_id = c.id AND un.ativo)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    // as cópias por ambiente ficam; só some a ligação com o ambiente
    await q.query(`DROP INDEX IF EXISTS idx_categorias_ambiente`);
    await q.query(`ALTER TABLE categorias DROP COLUMN IF EXISTS ambiente_id`);
  }
}
