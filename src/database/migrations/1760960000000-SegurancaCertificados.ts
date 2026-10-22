import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Segurança do login (bloqueio depois de senhas erradas, tela travada por inatividade) e
 * cadastro dos certificados digitais com aviso de vencimento.
 */
export class SegurancaCertificados1760960000000 implements MigrationInterface {
  name = 'SegurancaCertificados1760960000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS tentativas_falhas int NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS bloqueado_ate timestamptz`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS config_seguranca jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS certificados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        tipo varchar(10) NOT NULL DEFAULT 'A1',
        titular varchar(120) NOT NULL,
        cnpj varchar(14),
        validade date NOT NULL,
        fornecedor varchar(80),
        observacao varchar(300),
        impressora_id uuid,
        ultimo_aviso_impresso date,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS certificados`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS config_seguranca`);
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS bloqueado_ate`);
    await q.query(`ALTER TABLE usuarios DROP COLUMN IF EXISTS tentativas_falhas`);
  }
}
