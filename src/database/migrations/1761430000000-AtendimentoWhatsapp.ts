import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp com atendente: as conversas com os clientes (entrada pelo aviso do provedor Z-API/Evolution),
 * cada mensagem (do cliente, do atendente, da IA ou do celular do hotel) e as respostas prontas.
 */
export class AtendimentoWhatsapp1761430000000 implements MigrationInterface {
  name = 'AtendimentoWhatsapp1761430000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_conversas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        telefone varchar(20) NOT NULL,
        nome varchar(120),
        status varchar(12) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','ia','atendimento','encerrada')),
        atendente_id uuid,
        atendente_nome varchar(120),
        ia_ativa boolean NOT NULL DEFAULT true,
        nao_lidas int NOT NULL DEFAULT 0,
        ultima_mensagem varchar(300),
        ultima_mensagem_em timestamptz NOT NULL DEFAULT now(),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, telefone)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_conversas ON whatsapp_conversas(empresa_id, ultima_mensagem_em DESC)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_mensagens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        conversa_id uuid NOT NULL REFERENCES whatsapp_conversas(id) ON DELETE CASCADE,
        direcao varchar(8) NOT NULL CHECK (direcao IN ('entrada','saida')),
        autor varchar(10) NOT NULL CHECK (autor IN ('cliente','atendente','ia','celular','sistema')),
        autor_nome varchar(120),
        texto text NOT NULL,
        id_externo varchar(120),
        enviada boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens ON whatsapp_mensagens(conversa_id, criado_em)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_msg_externo ON whatsapp_mensagens(empresa_id, id_externo) WHERE id_externo IS NOT NULL`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_respostas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        titulo varchar(60) NOT NULL,
        texto varchar(2000) NOT NULL,
        ordem int NOT NULL DEFAULT 0,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS whatsapp_respostas`);
    await q.query(`DROP TABLE IF EXISTS whatsapp_mensagens`);
    await q.query(`DROP TABLE IF EXISTS whatsapp_conversas`);
  }
}
