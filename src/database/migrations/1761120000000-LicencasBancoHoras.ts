import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Licenças e afastamentos do funcionário (maternidade, INSS…), banco de horas (créditos das horas extras, ajustes, pagamentos)
 * e o fechamento do mês da escala (o que foi para o banco e o que vai para o holerite).
 */
export class LicencasBancoHoras1761120000000 implements MigrationInterface {
  name = 'LicencasBancoHoras1761120000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_licencas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        tipo varchar(20) NOT NULL,
        inicio date NOT NULL,
        fim date,
        documento_id uuid REFERENCES funcionario_documentos(id) ON DELETE SET NULL,
        observacao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_func_licencas ON funcionario_licencas (empresa_id, funcionario_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS banco_horas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        data date NOT NULL,
        minutos int NOT NULL,
        tipo varchar(12) NOT NULL,
        referencia varchar(20),
        vence_em date,
        observacao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_banco_horas ON banco_horas (empresa_id, funcionario_id, data)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS rh_horas_mes (
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        competencia char(7) NOT NULL,
        empresa_id uuid NOT NULL,
        extras_min int NOT NULL DEFAULT 0,
        destino_extras varchar(10) NOT NULL DEFAULT 'pagar',
        faltas int NOT NULL DEFAULT 0,
        destino_faltas varchar(10) NOT NULL DEFAULT 'descontar',
        noturno_min int NOT NULL DEFAULT 0,
        feriado_min int NOT NULL DEFAULT 0,
        fechado_por varchar(120),
        fechado_em timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (funcionario_id, competencia)
      )`);
    await q.query(`ALTER TABLE escala_dias ADD COLUMN IF NOT EXISTS minutos_banco int`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS banco_meses int NOT NULL DEFAULT 6`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE rh_config DROP COLUMN IF EXISTS banco_meses`);
    await q.query(`ALTER TABLE escala_dias DROP COLUMN IF EXISTS minutos_banco`);
    await q.query(`DROP TABLE IF EXISTS rh_horas_mes`);
    await q.query(`DROP TABLE IF EXISTS banco_horas`);
    await q.query(`DROP TABLE IF EXISTS funcionario_licencas`);
  }
}
