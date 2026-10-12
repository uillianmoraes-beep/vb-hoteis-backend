import { MigrationInterface, QueryRunner } from 'typeorm';

/** Troco no fechamento: valor recebido, troco e destino (devolvido ou gorjeta). */
export class Troco1760300000000 implements MigrationInterface {
  name = 'Troco1760300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS valor_recebido numeric(10,2)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS troco numeric(10,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS troco_destino varchar(10) CHECK (troco_destino IN ('cliente','gorjeta'))`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS gorjeta_para varchar(120)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS gorjeta_para`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS troco_destino`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS troco`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS valor_recebido`);
  }
}
