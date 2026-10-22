import { MigrationInterface, QueryRunner } from 'typeorm';

/** Código do comprovante (NSU / autorização / ID do Pix), maquininha e parcelas: base da conciliação bancária. */
export class CodigoComprovante1760930000000 implements MigrationInterface {
  name = 'CodigoComprovante1760930000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadia_pagamentos ADD COLUMN IF NOT EXISTS comprovante varchar(60)`);
    await q.query(`ALTER TABLE estadia_pagamentos ADD COLUMN IF NOT EXISTS maquininha varchar(40)`);
    await q.query(`ALTER TABLE estadia_pagamentos ADD COLUMN IF NOT EXISTS parcelas smallint`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_estadia_pagamentos_comprovante ON estadia_pagamentos (empresa_id, comprovante) WHERE comprovante IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_estadia_pagamentos_comprovante`);
    await q.query(`ALTER TABLE estadia_pagamentos DROP COLUMN IF EXISTS parcelas`);
    await q.query(`ALTER TABLE estadia_pagamentos DROP COLUMN IF EXISTS maquininha`);
    await q.query(`ALTER TABLE estadia_pagamentos DROP COLUMN IF EXISTS comprovante`);
  }
}
