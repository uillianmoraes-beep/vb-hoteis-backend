import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lote 3b: comanda completa — produtos e serviços, itens de consumo,
 * pagamentos divididos, eventos da comanda (transferência, troca de
 * cobrança, correções) e pacote (período mínimo).
 */
export class Comanda1760310000000 implements MigrationInterface {
  name = 'Comanda1760310000000';

  /**
   * Se a tabela já existe (tentativa anterior ou sobra de outro sistema no
   * mesmo banco): mantém se tiver as colunas que usamos; senão, guarda com
   * outro nome para não perder dados e cria a nossa.
   */
  private async prepararTabela(q: QueryRunner, tabela: string, colunas: string[]): Promise<void> {
    const existe = await q.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`, [tabela]);
    if (!existe.length) return;
    const cols: { column_name: string }[] = await q.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [tabela]);
    const tem = new Set(cols.map((c) => c.column_name));
    if (colunas.every((c) => tem.has(c))) return;
    const sufixo = `_antiga_${Date.now()}`;
    await q.query(`ALTER TABLE "${tabela}" RENAME TO "${tabela}${sufixo}"`);
    // índices têm nome único no schema: renomeia os da tabela antiga para não bloquear os nossos
    const idx: { indexname: string }[] = await q.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1`, [tabela + sufixo]);
    for (const i of idx) await q.query(`ALTER INDEX "${i.indexname}" RENAME TO "${i.indexname.slice(0, 40)}${sufixo}"`);
  }

  public async up(q: QueryRunner): Promise<void> {
    await this.prepararTabela(q, 'produtos', ['id', 'empresa_id', 'nome', 'codigo', 'grupo', 'tipo', 'preco', 'ativo', 'criado_em', 'atualizado_em']);
    await this.prepararTabela(q, 'estadia_itens', ['id', 'empresa_id', 'estadia_id', 'produto_id', 'descricao', 'quantidade', 'preco_unitario', 'total', 'status', 'motivo_estorno', 'usuario_id', 'usuario_nome', 'estornado_por', 'estornado_em', 'criado_em']);
    await this.prepararTabela(q, 'estadia_pagamentos', ['id', 'empresa_id', 'estadia_id', 'forma', 'valor', 'valor_recebido', 'troco', 'troco_destino', 'gorjeta_para', 'usuario_id', 'usuario_nome', 'criado_em']);
    await this.prepararTabela(q, 'estadia_eventos', ['id', 'empresa_id', 'estadia_id', 'tipo', 'descricao', 'usuario_id', 'usuario_nome', 'criado_em']);
    await q.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome varchar(120) NOT NULL,
        codigo varchar(30),
        grupo varchar(60),
        tipo varchar(10) NOT NULL DEFAULT 'produto' CHECK (tipo IN ('produto','servico')),
        preco numeric(10,2) NOT NULL DEFAULT 0,
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_produtos_empresa ON produtos(empresa_id)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_codigo ON produtos(empresa_id, lower(codigo)) WHERE codigo IS NOT NULL`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS estadia_itens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid NOT NULL REFERENCES estadias(id) ON DELETE CASCADE,
        produto_id uuid REFERENCES produtos(id) ON DELETE SET NULL,
        descricao varchar(120) NOT NULL,
        quantidade numeric(10,3) NOT NULL DEFAULT 1,
        preco_unitario numeric(10,2) NOT NULL,
        total numeric(10,2) NOT NULL,
        status varchar(10) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','estornado')),
        motivo_estorno text,
        usuario_id uuid,
        usuario_nome varchar(120),
        estornado_por varchar(120),
        estornado_em timestamptz,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_itens_estadia ON estadia_itens(estadia_id)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS estadia_pagamentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid NOT NULL REFERENCES estadias(id) ON DELETE CASCADE,
        forma varchar(20) NOT NULL,
        valor numeric(10,2) NOT NULL,
        valor_recebido numeric(10,2),
        troco numeric(10,2) NOT NULL DEFAULT 0,
        troco_destino varchar(10),
        gorjeta_para varchar(120),
        usuario_id uuid,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_pagamentos_estadia ON estadia_pagamentos(estadia_id)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS estadia_eventos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        estadia_id uuid NOT NULL REFERENCES estadias(id) ON DELETE CASCADE,
        tipo varchar(30) NOT NULL,
        descricao text NOT NULL,
        usuario_id uuid,
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_eventos_estadia ON estadia_eventos(estadia_id, criado_em)`);

    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS periodo_minimo_id uuid REFERENCES periodos(id) ON DELETE SET NULL`);
    await q.query(`ALTER TABLE estadias ADD COLUMN IF NOT EXISTS valor_consumo numeric(10,2)`);

    await q.query(`UPDATE perfis SET permissoes = permissoes || '["produtos.gerenciar","estadias.corrigir","estadias.estornar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'estadias.corrigir'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS valor_consumo`);
    await q.query(`ALTER TABLE estadias DROP COLUMN IF EXISTS periodo_minimo_id`);
    await q.query(`DROP TABLE IF EXISTS estadia_eventos`);
    await q.query(`DROP TABLE IF EXISTS estadia_pagamentos`);
    await q.query(`DROP TABLE IF EXISTS estadia_itens`);
    await q.query(`DROP TABLE IF EXISTS produtos`);
  }
}
