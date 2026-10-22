import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ficha completa do funcionário: contrato, cargo, salário, jornada e benefícios (só para quem cuida do RH)
 * e o histórico de salário e cargo.
 */
export class ContratoFuncionario1761060000000 implements MigrationInterface {
  name = 'ContratoFuncionario1761060000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_contratos (
        funcionario_id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL,
        cargo varchar(80),
        salario numeric(12,2),
        tipo_contrato varchar(15) NOT NULL DEFAULT 'clt',
        jornada varchar(15),
        horas_semana numeric(5,2),
        dependentes int NOT NULL DEFAULT 0,
        adicional_noturno boolean NOT NULL DEFAULT false,
        insalubridade_pct numeric(5,2),
        beneficios jsonb NOT NULL DEFAULT '[]'::jsonb,
        demissao date,
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS funcionario_salarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        funcionario_id uuid NOT NULL,
        data date NOT NULL,
        cargo varchar(80),
        salario numeric(12,2),
        salario_anterior numeric(12,2),
        percentual numeric(7,2),
        motivo varchar(200),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_func_salarios ON funcionario_salarios (funcionario_id, data DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS funcionario_salarios`);
    await q.query(`DROP TABLE IF EXISTS funcionario_contratos`);
  }
}
