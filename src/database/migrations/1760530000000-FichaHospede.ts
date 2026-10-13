import { MigrationInterface, QueryRunner } from 'typeorm';

/** FNRH: ficha do hóspede (preenchida na recepção ou pelo próprio hóspede via QR). */
export class FichaHospede1760530000000 implements MigrationInterface {
  name = 'FichaHospede1760530000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS fichas_hospede (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid,
        unidade_id uuid,
        token varchar(24) NOT NULL UNIQUE,
        status varchar(12) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','preenchida')),
        dados jsonb NOT NULL DEFAULT '{}'::jsonb,
        doc_foto text,
        assinatura text,
        lgpd_aceito_em timestamptz,
        preenchida_por varchar(20),
        preenchida_em timestamptz,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_fichas_estadia ON fichas_hospede(estadia_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_fichas_cpf ON fichas_hospede(empresa_id, ((dados->>'cpf')))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS fichas_hospede`);
  }
}
