import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nota fiscal no fechamento: o cliente escolhe se quer nota (com CPF/CNPJ
 * opcional). Fica "pendente" até a integração com o emissor (NFS-e da
 * hospedagem / NFC-e dos produtos) ser ligada.
 */
export class NotaFiscal1760320000000 implements MigrationInterface {
  name = 'NotaFiscal1760320000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_status varchar(12) NOT NULL DEFAULT 'nao'`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_documento varchar(14)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_nome varchar(120)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_email varchar(160)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_solicitada_em timestamptz`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estadias_nota_pendente ON estadias(empresa_id) WHERE nota_status = 'pendente'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_estadias_nota_pendente`);
    for (const c of ['nota_solicitada_em', 'nota_email', 'nota_nome', 'nota_documento', 'nota_status']) {
      await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
