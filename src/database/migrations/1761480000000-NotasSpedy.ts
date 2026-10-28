import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emissor de notas alternativo: cada CNPJ escolhe Focus NFe ou Spedy (com as chaves de sandbox e de produção da Spedy).
 * Cada nota guarda por qual empresa saiu, para consultar e cancelar no lugar certo.
 */
export class NotasSpedy1761480000000 implements MigrationInterface {
  name = 'NotasSpedy1761480000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS provedor varchar(10) NOT NULL DEFAULT 'focus'`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS spedy_chave_homologacao text`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS spedy_chave_producao text`);
    await q.query(`ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS provedor varchar(10) NOT NULL DEFAULT 'focus'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE notas_fiscais DROP COLUMN IF EXISTS provedor`);
    await q.query(`ALTER TABLE focus_emissores DROP COLUMN IF EXISTS spedy_chave_producao`);
    await q.query(`ALTER TABLE focus_emissores DROP COLUMN IF EXISTS spedy_chave_homologacao`);
    await q.query(`ALTER TABLE focus_emissores DROP COLUMN IF EXISTS provedor`);
  }
}
