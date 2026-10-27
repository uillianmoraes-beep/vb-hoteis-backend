import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Controle de temperatura dos equipamentos de frio (geladeiras, freezers, câmaras, frigobares da cozinha):
 * o equipamento com a faixa certa e o registro de cada leitura, com a ação tomada quando sai da faixa (Anvisa RDC 216).
 */
export class Temperaturas1761420000000 implements MigrationInterface {
  name = 'Temperaturas1761420000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS equipamentos_frio (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid,
        nome varchar(80) NOT NULL,
        tipo varchar(12) NOT NULL DEFAULT 'geladeira',
        local varchar(80),
        minimo numeric(5,1),
        maximo numeric(5,1),
        leituras_dia int NOT NULL DEFAULT 2,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS temperaturas_registros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        equipamento_id uuid NOT NULL REFERENCES equipamentos_frio(id) ON DELETE CASCADE,
        temperatura numeric(5,1) NOT NULL,
        fora_da_faixa boolean NOT NULL DEFAULT false,
        acao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_temperaturas ON temperaturas_registros(empresa_id, equipamento_id, criado_em DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS temperaturas_registros`);
    await q.query(`DROP TABLE IF EXISTS equipamentos_frio`);
  }
}
