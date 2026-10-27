import { MigrationInterface, QueryRunner } from 'typeorm';

/** Foto de cada produto e de cada tipo de enxoval (o arquivo fica na pasta do servidor; aqui só o nome e de onde veio). */
export class FotosProdutos1761350000000 implements MigrationInterface {
  name = 'FotosProdutos1761350000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const t of ['produtos', 'enxoval_tipos']) {
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS foto varchar(60)`);
      // auto | manual | removida | nao_achou
      await q.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS foto_origem varchar(12)`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['produtos', 'enxoval_tipos']) {
      await q.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS foto_origem`);
      await q.query(`ALTER TABLE ${t} DROP COLUMN IF EXISTS foto`);
    }
  }
}
