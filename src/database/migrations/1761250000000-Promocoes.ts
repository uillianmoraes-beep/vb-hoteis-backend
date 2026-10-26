import { MigrationInterface, QueryRunner } from 'typeorm';

/** Cupons e pacotes da reserva online, clube de fidelidade e reservas abandonadas (o hóspede não terminou). */
export class Promocoes1761250000000 implements MigrationInterface {
  name = 'Promocoes1761250000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS promocoes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        tipo varchar(10) NOT NULL,
        nome varchar(80) NOT NULL,
        codigo varchar(30),
        descricao varchar(400),
        desconto_pct numeric(5,2) NOT NULL DEFAULT 0,
        desconto_valor numeric(12,2) NOT NULL DEFAULT 0,
        acrescimo numeric(12,2) NOT NULL DEFAULT 0,
        min_noites int NOT NULL DEFAULT 1,
        valido_de date,
        valido_ate date,
        limite_usos int NOT NULL DEFAULT 0,
        usos int NOT NULL DEFAULT 0,
        ambiente_id uuid,
        ativo boolean NOT NULL DEFAULT true,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_promocoes ON promocoes (empresa_id, tipo)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS reservas_rascunhos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        ambiente_id uuid NOT NULL,
        nome varchar(120),
        telefone varchar(30) NOT NULL,
        email varchar(120),
        chegada date,
        saida date,
        adultos int,
        criancas int,
        categoria_id uuid,
        total numeric(12,2),
        reserva_id uuid,
        contatado_em timestamptz,
        contatado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_rascunhos ON reservas_rascunhos (empresa_id, atualizado_em)`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS cupom_codigo varchar(30)`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pacote_id uuid`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS pacote_nome varchar(80)`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS desconto numeric(12,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fidelidade jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS fidelidade`);
    for (const c of ['desconto', 'pacote_nome', 'pacote_id', 'cupom_codigo']) await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS ${c}`);
    await q.query(`DROP TABLE IF EXISTS reservas_rascunhos`);
    await q.query(`DROP TABLE IF EXISTS promocoes`);
  }
}
