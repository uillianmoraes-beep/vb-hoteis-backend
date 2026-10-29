import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A lei manda guardar as notas fiscais por 5 anos: o XML de cada nota autorizada, do cancelamento e da carta de correção
 * fica no próprio sistema (não só no emissor), e também o XML das notas de compra (entrada) que a empresa importa.
 * Daqui sai o pacote do mês para o contador: entradas, saídas, cartas de correção e canceladas.
 */
export class NotasXmlGuardado1761500000000 implements MigrationInterface {
  name = 'NotasXmlGuardado1761500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS xml_autorizado text`);
    await q.query(`ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS xml_guardado_em timestamptz`);
    await q.query(`ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS xml_tentativas int NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS xml_cancelamento text`);
    await q.query(`ALTER TABLE notas_fiscais ADD COLUMN IF NOT EXISTS xml_correcao text`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS notas_entrada (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        chave varchar(44) NOT NULL,
        numero varchar(20),
        emitente_cnpj varchar(14),
        emitente_nome varchar(150),
        valor numeric(12,2),
        emitida_em timestamptz,
        xml text NOT NULL,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, chave)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_notas_entrada_emp_data ON notas_entrada (empresa_id, emitida_em)`);
    await q.query(`CREATE INDEX IF NOT EXISTS ix_notas_fiscais_sem_xml ON notas_fiscais (criado_em) WHERE xml_autorizado IS NULL AND status IN ('autorizado','cancelado')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS ix_notas_fiscais_sem_xml`);
    await q.query(`DROP TABLE IF EXISTS notas_entrada`);
    for (const c of ['xml_correcao', 'xml_cancelamento', 'xml_tentativas', 'xml_guardado_em', 'xml_autorizado']) await q.query(`ALTER TABLE notas_fiscais DROP COLUMN IF EXISTS ${c}`);
  }
}
