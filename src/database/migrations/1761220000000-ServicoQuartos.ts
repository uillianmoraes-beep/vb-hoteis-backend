import { MigrationInterface, QueryRunner } from 'typeorm';

/** Serviço de quartos: o pedido ganha "saiu para entregar" (com quem leva), a origem (QR do quarto ou recepção) e quem lançou. */
export class ServicoQuartos1761220000000 implements MigrationInterface {
  name = 'ServicoQuartos1761220000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_status_check`);
    await q.query(`ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check CHECK (status IN ('novo','aceito','saiu','entregue','recusado'))`);
    await q.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origem varchar(10) NOT NULL DEFAULT 'qr'`);
    await q.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS levado_por varchar(120)`);
    await q.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS saiu_em timestamptz`);
    await q.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS lancado_por varchar(120)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['lancado_por', 'saiu_em', 'levado_por', 'origem']) await q.query(`ALTER TABLE pedidos DROP COLUMN IF EXISTS ${c}`);
    await q.query(`UPDATE pedidos SET status = 'aceito' WHERE status = 'saiu'`);
    await q.query(`ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_status_check`);
    await q.query(`ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check CHECK (status IN ('novo','aceito','entregue','recusado'))`);
  }
}
