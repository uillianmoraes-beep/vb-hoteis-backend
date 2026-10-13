import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enxoval: lotes de compra com QR code (peças novas ou já usadas), fotos nas perdas,
 * responsável pelo enxoval e relatório assinado (responsável + gerente) que,
 * depois de assinado, o próprio banco de dados impede de alterar ou excluir.
 */
export class EnxovalLotesRelatorio1760570000000 implements MigrationInterface {
  name = 'EnxovalLotesRelatorio1760570000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_lote integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ultimo_relatorio_enxoval integer NOT NULL DEFAULT 0`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS enxoval_lotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero integer NOT NULL,
        codigo varchar(20) NOT NULL,
        token varchar(24) NOT NULL UNIQUE,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        usadas boolean NOT NULL DEFAULT false,
        lavagens_iniciais integer NOT NULL DEFAULT 0,
        meses_uso integer,
        data_compra date NOT NULL,
        fornecedor varchar(120),
        nota_fiscal varchar(40),
        observacao varchar(300),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, codigo)
      )`);
    await q.query(`ALTER TABLE enxoval_movimentos ADD COLUMN IF NOT EXISTS lote_id uuid`);
    await q.query(`ALTER TABLE enxoval_movimentos ADD COLUMN IF NOT EXISTS fotos jsonb`);
    await q.query(`ALTER TABLE enxoval_movimentos ADD COLUMN IF NOT EXISTS relatorio_id uuid`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS enxoval_config (
        empresa_id uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
        responsavel_usuario_id uuid,
        responsavel_nome varchar(120),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS enxoval_relatorios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id),
        numero integer NOT NULL,
        de date NOT NULL,
        ate date NOT NULL,
        conteudo text NOT NULL,
        hash varchar(64) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','assinado_responsavel','assinado')),
        resp_usuario_id uuid, resp_nome varchar(120), resp_assinatura text, resp_assinado_em timestamptz, resp_ip varchar(60),
        ger_usuario_id uuid, ger_nome varchar(120), ger_assinatura text, ger_assinado_em timestamptz, ger_ip varchar(60),
        hash_final varchar(64),
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);

    // ---- trava no banco: relatório assinado não muda nem some ----
    await q.query(`
      CREATE OR REPLACE FUNCTION enxoval_relatorio_trava() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.resp_assinado_em IS NOT NULL OR OLD.ger_assinado_em IS NOT NULL THEN
            RAISE EXCEPTION 'Relatório do enxoval assinado não pode ser excluído.';
          END IF;
          RETURN OLD;
        END IF;
        IF OLD.ger_assinado_em IS NOT NULL THEN
          RAISE EXCEPTION 'Relatório do enxoval assinado não pode ser alterado.';
        END IF;
        IF OLD.resp_assinado_em IS NOT NULL THEN
          -- depois da 1ª assinatura só entra a do gerente; o resto fica idêntico
          IF NEW.conteudo IS DISTINCT FROM OLD.conteudo OR NEW.hash IS DISTINCT FROM OLD.hash OR NEW.de IS DISTINCT FROM OLD.de
             OR NEW.ate IS DISTINCT FROM OLD.ate OR NEW.numero IS DISTINCT FROM OLD.numero OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
             OR NEW.resp_usuario_id IS DISTINCT FROM OLD.resp_usuario_id OR NEW.resp_nome IS DISTINCT FROM OLD.resp_nome
             OR NEW.resp_assinatura IS DISTINCT FROM OLD.resp_assinatura OR NEW.resp_assinado_em IS DISTINCT FROM OLD.resp_assinado_em
             OR NEW.resp_ip IS DISTINCT FROM OLD.resp_ip OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
            RAISE EXCEPTION 'Relatório do enxoval assinado não pode ser alterado.';
          END IF;
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await q.query(`DROP TRIGGER IF EXISTS trg_enxoval_relatorio_trava ON enxoval_relatorios`);
    await q.query(`CREATE TRIGGER trg_enxoval_relatorio_trava BEFORE UPDATE OR DELETE ON enxoval_relatorios FOR EACH ROW EXECUTE FUNCTION enxoval_relatorio_trava()`);

    // movimento que entrou num relatório assinado (com as fotos) também fica travado
    await q.query(`
      CREATE OR REPLACE FUNCTION enxoval_movimento_trava() RETURNS trigger AS $$
      BEGIN
        IF OLD.relatorio_id IS NOT NULL THEN
          RAISE EXCEPTION 'Movimento do enxoval que está em relatório assinado não pode ser alterado nem excluído.';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        IF NEW.tipo_id IS DISTINCT FROM OLD.tipo_id OR NEW.movimento IS DISTINCT FROM OLD.movimento OR NEW.quantidade IS DISTINCT FROM OLD.quantidade
           OR NEW.fotos IS DISTINCT FROM OLD.fotos OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
          RAISE EXCEPTION 'Movimento do enxoval não pode ser alterado.';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await q.query(`DROP TRIGGER IF EXISTS trg_enxoval_movimento_trava ON enxoval_movimentos`);
    await q.query(`CREATE TRIGGER trg_enxoval_movimento_trava BEFORE UPDATE OR DELETE ON enxoval_movimentos FOR EACH ROW EXECUTE FUNCTION enxoval_movimento_trava()`);

    // modelo de perfil: responsável pelo enxoval (vê e lança tudo do enxoval)
    await q.query(`
      INSERT INTO perfis (empresa_id, nome, descricao, permissoes)
      SELECT id, 'Responsável do enxoval', 'Cuida de todo o enxoval: lotes, lavanderia, perdas com foto, contagem e assina o relatório.',
             '["painel.ver","governanca.operar","enxoval.gerenciar"]'::jsonb
        FROM empresas
      ON CONFLICT (empresa_id, nome) DO NOTHING`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["enxoval.aprovar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'enxoval.aprovar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS trg_enxoval_movimento_trava ON enxoval_movimentos`);
    await q.query(`DROP TRIGGER IF EXISTS trg_enxoval_relatorio_trava ON enxoval_relatorios`);
    await q.query(`DROP FUNCTION IF EXISTS enxoval_movimento_trava()`);
    await q.query(`DROP FUNCTION IF EXISTS enxoval_relatorio_trava()`);
  }
}
