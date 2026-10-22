import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Férias (programação por período aquisitivo, faltas e períodos antigos já tirados), 13º (parcelas pagas)
 * e a configuração dos encargos do RH (FGTS e INSS patronal) para as provisões e o custo real.
 */
export class FeriasDecimo1761090000000 implements MigrationInterface {
  name = 'FeriasDecimo1761090000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_ferias (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        aquisitivo_inicio date NOT NULL,
        inicio date NOT NULL,
        dias int NOT NULL,
        abono_dias int NOT NULL DEFAULT 0,
        adiantar_13 boolean NOT NULL DEFAULT false,
        status varchar(12) NOT NULL DEFAULT 'programada',
        observacao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_func_ferias ON funcionario_ferias (empresa_id, funcionario_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_ferias_periodos (
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        aquisitivo_inicio date NOT NULL,
        empresa_id uuid NOT NULL,
        faltas int NOT NULL DEFAULT 0,
        quitado boolean NOT NULL DEFAULT false,
        observacao varchar(300),
        PRIMARY KEY (funcionario_id, aquisitivo_inicio)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_decimo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        ano int NOT NULL,
        parcela int NOT NULL,
        valor numeric(12,2) NOT NULL,
        data date NOT NULL,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (funcionario_id, ano, parcela)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_config (
        empresa_id uuid PRIMARY KEY,
        fgts_pct numeric(5,2) NOT NULL DEFAULT 8,
        encargos_pct numeric(5,2),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS rh_config`);
    await q.query(`DROP TABLE IF EXISTS funcionario_decimo`);
    await q.query(`DROP TABLE IF EXISTS funcionario_ferias_periodos`);
    await q.query(`DROP TABLE IF EXISTS funcionario_ferias`);
  }
}
