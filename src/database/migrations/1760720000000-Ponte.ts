import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ponte nuvem ⇄ servidor local: a nuvem guarda o que chega pela internet (reserva online,
 * pedido do hóspede no 4G, aviso de pagamento) para o servidor local buscar; o servidor
 * local manda para a nuvem um espelho do que a internet precisa ver (quartos, reservas…).
 */
export class Ponte1760720000000 implements MigrationInterface {
  name = 'Ponte1760720000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS ponte_eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        tipo varchar(20) NOT NULL,
        dados jsonb NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now(),
        entregue_em timestamptz
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_ponte_pendentes ON ponte_eventos(empresa_id, criado_em) WHERE entregue_em IS NULL`);
    await q.query(`ALTER TABLE licenca_local ADD COLUMN IF NOT EXISTS ultima_sincronizacao timestamptz`);
    await q.query(`ALTER TABLE licenca_local ADD COLUMN IF NOT EXISTS espelho_hash varchar(64)`);
    await q.query(`ALTER TABLE licenca_local ADD COLUMN IF NOT EXISTS backup_enviado_em timestamptz`);
    await q.query(`ALTER TABLE licenca_local ADD COLUMN IF NOT EXISTS erro_ponte varchar(300)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS ponte_eventos`);
    for (const c of ['ultima_sincronizacao', 'espelho_hash', 'backup_enviado_em', 'erro_ponte']) await q.query(`ALTER TABLE licenca_local DROP COLUMN IF EXISTS ${c}`);
  }
}
