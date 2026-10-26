import { MigrationInterface, QueryRunner } from 'typeorm';

/** Estoque de ferramentas da manutenção: cadastro com foto, entrega/devolução por responsável e pedidos de compra com pré-aprovação. */
export class Ferramentas1761150000000 implements MigrationInterface {
  name = 'Ferramentas1761150000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS ferramentas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        codigo int NOT NULL,
        nome varchar(120) NOT NULL,
        tipo varchar(15) NOT NULL DEFAULT 'ferramenta',
        marca varchar(60),
        modelo varchar(60),
        numero_serie varchar(60),
        quantidade int NOT NULL DEFAULT 1,
        estoque_minimo int NOT NULL DEFAULT 0,
        valor numeric(12,2),
        local varchar(80),
        foto varchar(300),
        observacao varchar(300),
        ativo boolean NOT NULL DEFAULT true,
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, codigo)
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS ferramenta_entregas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        ferramenta_id uuid NOT NULL REFERENCES ferramentas(id) ON DELETE CASCADE,
        funcionario_id uuid REFERENCES funcionarios(id) ON DELETE SET NULL,
        responsavel varchar(120) NOT NULL,
        quantidade int NOT NULL DEFAULT 1,
        entregue_em timestamptz NOT NULL DEFAULT now(),
        previsao date,
        para_que varchar(200),
        entregue_por varchar(120),
        devolvida_em timestamptz,
        estado varchar(10),
        observacao_devolucao varchar(300),
        recebido_por varchar(120)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_ferr_entregas ON ferramenta_entregas (empresa_id, ferramenta_id)`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS ferramenta_movimentos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        ferramenta_id uuid NOT NULL REFERENCES ferramentas(id) ON DELETE CASCADE,
        tipo varchar(12) NOT NULL,
        quantidade int NOT NULL,
        valor numeric(12,2),
        motivo varchar(300),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS ferramenta_pedidos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL,
        ferramenta_id uuid REFERENCES ferramentas(id) ON DELETE SET NULL,
        descricao varchar(200) NOT NULL,
        quantidade int NOT NULL DEFAULT 1,
        motivo varchar(300),
        urgente boolean NOT NULL DEFAULT false,
        status varchar(10) NOT NULL DEFAULT 'pendente',
        solicitado_por varchar(120),
        decidido_por varchar(120),
        decidido_em timestamptz,
        motivo_recusa varchar(300),
        cotacao_id uuid,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["ferramentas.gerenciar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'ferramentas.gerenciar'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['ferramenta_pedidos', 'ferramenta_movimentos', 'ferramenta_entregas', 'ferramentas']) await q.query(`DROP TABLE IF EXISTS ${t}`);
  }
}
