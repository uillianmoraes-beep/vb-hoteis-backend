import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reserva online: configuração por ambiente (hotel/pousada) em jsonb — preços por categoria,
 * destaque/acréscimo por quarto (ex.: vista para o mar), confirmação automática ou pela recepção.
 * Cada reserva ganha um código para o hóspede acompanhar.
 */
export class ReservaOnline1760670000000 implements MigrationInterface {
  name = 'ReservaOnline1760670000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS reserva_online jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS token_reserva varchar(24)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ambientes_token_reserva ON ambientes(token_reserva) WHERE token_reserva IS NOT NULL`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS codigo_publico varchar(16)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_reservas_codigo_publico ON reservas(codigo_publico) WHERE codigo_publico IS NOT NULL`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS categoria_pedida varchar(80)`);
    await q.query(`ALTER TABLE reservas ADD COLUMN IF NOT EXISTS quarto_escolhido boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['codigo_publico', 'categoria_pedida', 'quarto_escolhido']) await q.query(`ALTER TABLE reservas DROP COLUMN IF EXISTS ${c}`);
    for (const c of ['reserva_online', 'token_reserva']) await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS ${c}`);
  }
}
