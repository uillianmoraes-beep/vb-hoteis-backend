import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Venda por módulos: o plano (porte) traz o limite de suítes/quartos e de produtos; os módulos fiscais
 * (NFC-e, NFS-e, NF-e) são contratados à parte, cada um com o seu preço (somado na mensalidade).
 */
export class ModulosAvulsos1761510000000 implements MigrationInterface {
  name = 'ModulosAvulsos1761510000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE revenda_config ADD COLUMN IF NOT EXISTS precos_modulos jsonb NOT NULL DEFAULT '{"nfce":70,"nfse":70,"nfe":70}'::jsonb`);
    await q.query(`ALTER TABLE planos ADD COLUMN IF NOT EXISTS limite_produtos int`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS adicionais jsonb NOT NULL DEFAULT '{}'::jsonb`);
    // limites de exemplo dos planos (o dono muda em Revenda › Planos)
    await q.query(`UPDATE planos SET limite_unidades = 16, limite_produtos = 200 WHERE segmento = 'hospedagem' AND porte = 'pequeno' AND limite_produtos IS NULL`);
    await q.query(`UPDATE planos SET limite_produtos = 600 WHERE porte = 'medio' AND limite_produtos IS NULL`);
    await q.query(`UPDATE planos SET limite_produtos = 200 WHERE segmento = 'restaurante' AND porte = 'pequeno' AND limite_produtos IS NULL`);
    // quem já tinha o módulo de notas continua emitindo tudo (os módulos fiscais passam a ser à parte só para quem contratar agora)
    await q.query(`UPDATE empresas SET modulos = modulos || '{"nfce":true,"nfse":true,"nfe":true}'::jsonb WHERE (modulos->>'notas')::boolean IS TRUE`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS adicionais`);
    await q.query(`ALTER TABLE planos DROP COLUMN IF EXISTS limite_produtos`);
    await q.query(`ALTER TABLE revenda_config DROP COLUMN IF EXISTS precos_modulos`);
  }
}
