import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emissor próprio da NFC-e (direto na SEFAZ): dados do estabelecimento que vão na nota (razão social, IE, endereço),
 * o CSC (cifrado), a série e a numeração da NFC-e própria em cada ambiente.
 */
export class NfceProprio1761530000000 implements MigrationInterface {
  name = 'NfceProprio1761530000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS nfce_proprio boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS emitente jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS csc_id varchar(10)`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS csc_token text`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS nfce_serie int NOT NULL DEFAULT 1`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS nfce_proximo_homologacao int NOT NULL DEFAULT 1`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS nfce_proximo_producao int NOT NULL DEFAULT 1`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['nfce_proximo_producao', 'nfce_proximo_homologacao', 'nfce_serie', 'csc_token', 'csc_id', 'emitente', 'nfce_proprio']) {
      await q.query(`ALTER TABLE focus_emissores DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
