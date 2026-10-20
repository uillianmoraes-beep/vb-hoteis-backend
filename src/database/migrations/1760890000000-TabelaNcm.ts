import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabela oficial de NCM (Siscomex), baixada na primeira busca de tributação e guardada aqui:
 * código de 8 dígitos, a descrição do item e o caminho completo (capítulo › posição › item).
 */
export class TabelaNcm1760890000000 implements MigrationInterface {
  name = 'TabelaNcm1760890000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS ncm (
        codigo varchar(8) PRIMARY KEY,
        descricao text NOT NULL,
        completa text NOT NULL,
        busca text NOT NULL
      )`);
    await q.query(`CREATE TABLE IF NOT EXISTS ncm_versao (id int PRIMARY KEY DEFAULT 1, vigencia varchar(80), baixado_em timestamptz NOT NULL DEFAULT now())`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS ncm_versao`);
    await q.query(`DROP TABLE IF EXISTS ncm`);
  }
}
