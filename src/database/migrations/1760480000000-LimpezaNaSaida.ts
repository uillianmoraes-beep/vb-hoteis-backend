import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suíte paga aguardando saída: ao fechar a conta a unidade fica "paga" e só vai
 * para limpeza quando o portão confere o ticket (ambientes com limpeza na saída).
 */
export class LimpezaNaSaida1760480000000 implements MigrationInterface {
  name = 'LimpezaNaSaida1760480000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT conname FROM pg_constraint
          WHERE conrelid = 'unidades'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%conta_entregue%'
        LOOP EXECUTE 'ALTER TABLE unidades DROP CONSTRAINT ' || quote_ident(r.conname); END LOOP;
      END $$`);
    await q.query(`ALTER TABLE unidades ADD CONSTRAINT ck_unidades_status CHECK (status IN ('livre','ocupada','conta_entregue','paga','limpeza','vistoria','bloqueada','reservada'))`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS limpeza_na_saida boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE ambientes SET limpeza_na_saida = true WHERE tipo = 'motel'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE unidades SET status = 'limpeza' WHERE status = 'paga'`);
    await q.query(`ALTER TABLE unidades DROP CONSTRAINT IF EXISTS ck_unidades_status`);
    await q.query(`ALTER TABLE unidades ADD CONSTRAINT ck_unidades_status CHECK (status IN ('livre','ocupada','conta_entregue','limpeza','vistoria','bloqueada','reservada'))`);
    await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS limpeza_na_saida`);
  }
}
