import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Emissão de notas pela Focus NFe: o emissor de cada CNPJ (ambiente, tokens cifrados, dados da prefeitura)
 * e as notas emitidas pelo sistema (NFC-e, NF-e, NFS-e, NFS-e nacional e devolução).
 */
export class NotasFocus1761370000000 implements MigrationInterface {
  name = 'NotasFocus1761370000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS focus_emissores (
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cnpj varchar(14) NOT NULL,
        ambiente varchar(12) NOT NULL DEFAULT 'homologacao' CHECK (ambiente IN ('homologacao','producao')),
        token_homologacao text,
        token_producao text,
        nfse_padrao varchar(10) NOT NULL DEFAULT 'nacional' CHECK (nfse_padrao IN ('nacional','municipal')),
        dados jsonb NOT NULL DEFAULT '{}'::jsonb,
        dps_serie int NOT NULL DEFAULT 1,
        dps_proximo_homologacao int NOT NULL DEFAULT 1,
        dps_proximo_producao int NOT NULL DEFAULT 1,
        atualizado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_por varchar(120),
        PRIMARY KEY (empresa_id, cnpj)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS notas_fiscais (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        cnpj_emitente varchar(14) NOT NULL,
        tipo varchar(10) NOT NULL CHECK (tipo IN ('nfce','nfe','nfse','nfsen','devolucao')),
        ambiente varchar(12) NOT NULL,
        ref varchar(60) NOT NULL UNIQUE,
        origem varchar(12) NOT NULL DEFAULT 'manual',
        estadia_id uuid,
        parte_id uuid,
        nota_referenciada_id uuid,
        chave_referenciada varchar(44),
        status varchar(20) NOT NULL DEFAULT 'processando',
        numero varchar(20),
        serie varchar(10),
        chave varchar(50),
        mensagem text,
        valor_total numeric(12,2) NOT NULL DEFAULT 0,
        destinatario_nome varchar(150),
        destinatario_documento varchar(14),
        url_xml text,
        url_pdf text,
        url_consulta text,
        envio jsonb,
        resposta jsonb,
        justificativa_cancelamento varchar(255),
        cancelada_em timestamptz,
        cancelada_por varchar(120),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_notas_fiscais_empresa ON notas_fiscais(empresa_id, criado_em DESC)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_notas_fiscais_estadia ON notas_fiscais(estadia_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_notas_fiscais_processando ON notas_fiscais(status) WHERE status = 'processando'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS notas_fiscais`);
    await q.query(`DROP TABLE IF EXISTS focus_emissores`);
  }
}
