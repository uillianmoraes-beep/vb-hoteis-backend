import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Configuração fiscal central: regras por documento (NFC-e, NF-e, NFS-e,
 * devolução) — uma padrão (sem CFOP) e quantas quiser por CFOP. O produto
 * herda o que deixar em branco. A tributação da hospedagem vira a regra
 * padrão da NFS-e.
 */
export class RegrasFiscais1760360000000 implements MigrationInterface {
  name = 'RegrasFiscais1760360000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS regras_fiscais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        documento varchar(10) NOT NULL CHECK (documento IN ('nfce','nfe','nfs','devolucao')),
        cfop varchar(4),
        nome varchar(120) NOT NULL,
        dados jsonb NOT NULL DEFAULT '{}'::jsonb,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_regra_fiscal ON regras_fiscais(empresa_id, documento, COALESCE(cfop, ''))`);
    // hospedagem configurada antes vira a regra padrão da NFS-e
    await q.query(`
      INSERT INTO regras_fiscais (empresa_id, documento, cfop, nome, dados)
      SELECT id, 'nfs', NULL, 'Hospedagem (padrão NFS-e)', fiscal->'hospedagem'
      FROM empresas WHERE fiscal ? 'hospedagem' AND fiscal->'hospedagem' <> '{}'::jsonb
      ON CONFLICT DO NOTHING`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS regras_fiscais`);
  }
}
