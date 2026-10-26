import { MigrationInterface, QueryRunner } from 'typeorm';

/** Login do contador: perfil Contador (só a área do contador) e o que ele entrega no mês (folha, guias…). */
export class AreaContador1761160000000 implements MigrationInterface {
  name = 'AreaContador1761160000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS contador_entregas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        competencia char(7) NOT NULL,
        tipo varchar(12) NOT NULL,
        descricao varchar(200),
        valor numeric(14,2),
        vencimento date,
        arquivo varchar(300) NOT NULL,
        mime varchar(40) NOT NULL,
        nome_arquivo varchar(160),
        bytes int,
        conta_pagar_id uuid,
        enviado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_contador_entregas ON contador_entregas (empresa_id, competencia)`);
    await q.query(`
      INSERT INTO perfis (empresa_id, nome, descricao, permissoes, limites)
      SELECT id, 'Contador', 'Contabilidade de fora: só a área do contador (entregar folha e guias, ver as notas, holerites e Simples)', '["contador.acessar"]'::jsonb, '{}'::jsonb
      FROM empresas
      ON CONFLICT (empresa_id, nome) DO NOTHING`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS contador_entregas`);
  }
}
