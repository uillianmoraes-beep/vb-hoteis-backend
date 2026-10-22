import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reserva do caixa ADM: compromissos do mês (fixos, variáveis pela média, folha, imposto) e o dinheiro
 * separado todo dia do movimento para pagar esses compromissos (na gaveta do ADM ou num banco).
 */
export class ReservaCaixa1761070000000 implements MigrationInterface {
  name = 'ReservaCaixa1761070000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS reserva_compromissos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        nome varchar(80) NOT NULL,
        tipo varchar(10) NOT NULL,
        valor numeric(12,2),
        categoria varchar(60),
        percentual numeric(6,2),
        dia int NOT NULL,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS reserva_movimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        data date NOT NULL,
        tipo varchar(10) NOT NULL,
        valor numeric(12,2) NOT NULL DEFAULT 0,
        origem varchar(10) NOT NULL DEFAULT 'dinheiro',
        conta_bancaria_id uuid,
        compromisso_id uuid,
        descricao varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_reserva_mov ON reserva_movimentos (empresa_id, data)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS reserva_movimentos`);
    await q.query(`DROP TABLE IF EXISTS reserva_compromissos`);
  }
}
