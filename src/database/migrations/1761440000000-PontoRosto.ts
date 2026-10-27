import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ponto de controle interno (não é o ponto oficial REP-P): o funcionário bate o ponto no tablet ou pelo link no celular,
 * com a foto do rosto (comparada com a cadastrada) e a localização. Guarda o consentimento de biometria (LGPD).
 */
export class PontoRosto1761440000000 implements MigrationInterface {
  name = 'PontoRosto1761440000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS ponto_token varchar(40)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_funcionarios_ponto_token ON funcionarios(ponto_token) WHERE ponto_token IS NOT NULL`);
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS rosto_descritor jsonb`);
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS rosto_foto varchar(200)`);
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS rosto_consentimento_em timestamptz`);
    await q.query(`ALTER TABLE funcionarios ADD COLUMN IF NOT EXISTS rosto_consentimento_por varchar(120)`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS ponto_lat numeric(9,6)`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS ponto_lng numeric(9,6)`);
    await q.query(`ALTER TABLE ambientes ADD COLUMN IF NOT EXISTS ponto_raio int NOT NULL DEFAULT 200`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS ponto_registros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        funcionario_id uuid NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
        momento timestamptz NOT NULL DEFAULT now(),
        origem varchar(10) NOT NULL DEFAULT 'tablet' CHECK (origem IN ('tablet','celular','ajuste')),
        foto varchar(200),
        distancia_rosto numeric(6,4),
        rosto_ok boolean,
        lat numeric(9,6),
        lng numeric(9,6),
        precisao_m int,
        distancia_local_m int,
        local_ok boolean,
        ambiente_id uuid,
        observacao varchar(300),
        registrado_por varchar(120),
        anulado boolean NOT NULL DEFAULT false,
        anulado_motivo varchar(300),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_ponto_registros ON ponto_registros(empresa_id, funcionario_id, momento)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS ponto_registros`);
    for (const c of ['ponto_raio', 'ponto_lng', 'ponto_lat']) await q.query(`ALTER TABLE ambientes DROP COLUMN IF EXISTS ${c}`);
    for (const c of ['rosto_consentimento_por', 'rosto_consentimento_em', 'rosto_foto', 'rosto_descritor', 'ponto_token']) await q.query(`ALTER TABLE funcionarios DROP COLUMN IF EXISTS ${c}`);
  }
}
