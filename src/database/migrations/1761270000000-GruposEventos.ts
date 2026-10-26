import { MigrationInterface, QueryRunner } from 'typeorm';

/** Grupos (caravanas, romarias, empresas) com quartos e refeições, e eventos (salões, festas, reuniões) com orçamento. */
export class GruposEventos1761270000000 implements MigrationInterface {
  name = 'GruposEventos1761270000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS grupos_hospedagem (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(120) NOT NULL,
        tipo varchar(12) NOT NULL DEFAULT 'caravana',
        ambiente_id uuid,
        responsavel varchar(120),
        telefone varchar(30),
        cliente_faturado_id uuid,
        chegada date NOT NULL,
        saida date NOT NULL,
        pessoas int NOT NULL,
        onibus int NOT NULL DEFAULT 0,
        motoristas int NOT NULL DEFAULT 0,
        guias int NOT NULL DEFAULT 0,
        cafe boolean NOT NULL DEFAULT false,
        almoco boolean NOT NULL DEFAULT false,
        jantar boolean NOT NULL DEFAULT false,
        valor_pessoa_noite numeric(12,2) NOT NULL DEFAULT 0,
        desconto numeric(12,2) NOT NULL DEFAULT 0,
        quartos jsonb NOT NULL DEFAULT '[]'::jsonb,
        observacao varchar(800),
        status varchar(12) NOT NULL DEFAULT 'orcamento',
        faturado_em timestamptz,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_grupos_hosp ON grupos_hospedagem (empresa_id, chegada)`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS grupo_hosp_id uuid`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(120) NOT NULL,
        tipo varchar(20) NOT NULL DEFAULT 'festa',
        espaco varchar(80) NOT NULL,
        data date NOT NULL,
        inicio varchar(5),
        fim varchar(5),
        pessoas int NOT NULL DEFAULT 1,
        cliente varchar(120) NOT NULL,
        telefone varchar(30),
        cliente_faturado_id uuid,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        desconto numeric(12,2) NOT NULL DEFAULT 0,
        sinal numeric(12,2) NOT NULL DEFAULT 0,
        observacao varchar(800),
        status varchar(12) NOT NULL DEFAULT 'orcamento',
        faturado_em timestamptz,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_eventos ON eventos (empresa_id, data)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS eventos`);
    await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS grupo_hosp_id`);
    await q.query(`DROP TABLE IF EXISTS grupos_hospedagem`);
  }
}
