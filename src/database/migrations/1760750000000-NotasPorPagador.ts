import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pagador separado: a mesma conta com dois pagadores (ex.: a empresa paga a hospedagem
 * e o hóspede o consumo). Cada parte vira uma nota a emitir, com o documento de quem pagou.
 */
export class NotasPorPagador1760750000000 implements MigrationInterface {
  name = 'NotasPorPagador1760750000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS estadia_notas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid NOT NULL REFERENCES estadias(id) ON DELETE CASCADE,
        pagador varchar(10) NOT NULL,
        nome varchar(120),
        documento varchar(14),
        parte varchar(12) NOT NULL,
        valor numeric(12,2) NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'pendente',
        numero varchar(30),
        emitida_em timestamptz,
        emitida_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estadia_notas_estadia ON estadia_notas (estadia_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS estadia_notas`);
  }
}
