import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emissor próprio da NFS-e nacional: o CNPJ pode mandar a NFS-e direto ao sistema nacional (sem Focus/Spedy),
 * com o certificado A1 guardado cifrado (arquivo e senha), a validade e o titular para o aviso de vencimento.
 */
export class NfseProprio1761490000000 implements MigrationInterface {
  name = 'NfseProprio1761490000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS nfse_proprio boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS cert_pfx text`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS cert_senha text`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS cert_validade timestamptz`);
    await q.query(`ALTER TABLE focus_emissores ADD COLUMN IF NOT EXISTS cert_titular varchar(200)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['cert_titular', 'cert_validade', 'cert_senha', 'cert_pfx', 'nfse_proprio']) await q.query(`ALTER TABLE focus_emissores DROP COLUMN IF EXISTS ${c}`);
  }
}
