import { MigrationInterface, QueryRunner } from 'typeorm';

/** Licença por módulos: quais módulos opcionais cada empresa contratou. */
export class Modulos1760350000000 implements MigrationInterface {
  name = 'Modulos1760350000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS modulos jsonb NOT NULL DEFAULT '{}'::jsonb`);
    // empresas que já existiam (demonstração da Virtual Barra) ficam com tudo liberado;
    // clientes novos começam só com o núcleo e recebem os módulos contratados.
    await q.query(`UPDATE empresas SET modulos = '{"notas":true,"caixa":true,"estoque":true,"hotel":true,"restaurante":true,"manutencao":true}'::jsonb WHERE modulos = '{}'::jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS modulos`);
  }
}
