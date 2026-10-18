import { MigrationInterface, QueryRunner } from 'typeorm';

/** Logotipo da empresa (imagem em data URL) para sair nos cupons e documentos impressos. */
export class LogoEmpresa1760740000000 implements MigrationInterface {
  name = 'LogoEmpresa1760740000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo text`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS logo`);
  }
}
