import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notas simplificadas (opcional por empresa): com o controle ligado, toda conta
 * fechada entra em "para emitir";
 * a recepção marca como emitida (com o número) logo após fechar ou depois,
 * pelo relatório. CPF/CNPJ fica para o cadastro de hóspede do hotel.
 */
export class NotasEmissao1760330000000 implements MigrationInterface {
  name = 'NotasEmissao1760330000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_numero varchar(30)`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_emitida_em timestamptz`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS nota_emitida_por varchar(120)`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["notas.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'notas.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const c of ['nota_emitida_por', 'nota_emitida_em', 'nota_numero']) await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS ${c}`);
  }
}
