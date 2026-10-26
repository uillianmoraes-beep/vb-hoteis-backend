import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Escala de trabalho: turnos (modelos de horário), o dia a dia de cada funcionário (trabalho, folga, falta, atestado),
 * feriados da cidade/estado e as regras usadas nos alertas (dá para mudar quando a lei da 6x1 mudar).
 */
export class EscalaTrabalho1761100000000 implements MigrationInterface {
  name = 'EscalaTrabalho1761100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS escala_turnos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(40) NOT NULL,
        inicio varchar(5) NOT NULL,
        fim varchar(5) NOT NULL,
        intervalo_min int NOT NULL DEFAULT 60,
        cor varchar(9),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_escala_turnos ON escala_turnos (empresa_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS escala_dias (
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        data date NOT NULL,
        empresa_id uuid NOT NULL,
        tipo varchar(10) NOT NULL,
        turno_id uuid,
        inicio varchar(5),
        fim varchar(5),
        intervalo_min int NOT NULL DEFAULT 0,
        observacao varchar(200),
        usuario_nome varchar(120),
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (funcionario_id, data)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_escala_dias ON escala_dias (empresa_id, data)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS feriados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        data date NOT NULL,
        nome varchar(80) NOT NULL,
        UNIQUE (empresa_id, data)
      )`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS escala_max_dias_seguidos int NOT NULL DEFAULT 6`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS escala_interjornada_h numeric(4,2) NOT NULL DEFAULT 11`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS escala_jornada_max_h numeric(4,2) NOT NULL DEFAULT 10`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS escala_domingo_semanas int NOT NULL DEFAULT 7`);
    await q.query(`ALTER TABLE rh_config ADD COLUMN IF NOT EXISTS escala_horas_semana numeric(5,2) NOT NULL DEFAULT 44`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['escala_max_dias_seguidos', 'escala_interjornada_h', 'escala_jornada_max_h', 'escala_domingo_semanas', 'escala_horas_semana']) {
      await q.query(`ALTER TABLE rh_config DROP COLUMN IF EXISTS ${c}`);
    }
    await q.query(`DROP TABLE IF EXISTS feriados`);
    await q.query(`DROP TABLE IF EXISTS escala_dias`);
    await q.query(`DROP TABLE IF EXISTS escala_turnos`);
  }
}
