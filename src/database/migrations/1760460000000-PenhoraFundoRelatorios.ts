import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Penhora (o cliente deixa um objeto como garantia e paga depois),
 * fundo que fica na gaveta para o próximo turno, valor entregue no fechamento
 * e a permissão dos relatórios gerenciais.
 */
export class PenhoraFundoRelatorios1760460000000 implements MigrationInterface {
  name = 'PenhoraFundoRelatorios1760460000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS penhoras (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        ambiente_id uuid NOT NULL,
        estadia_id uuid REFERENCES estadias(id) ON DELETE SET NULL,
        pagamento_id uuid,
        turno_id uuid REFERENCES caixa_turnos(id) ON DELETE SET NULL,
        valor numeric(10,2) NOT NULL CHECK (valor > 0),
        item varchar(200) NOT NULL,
        contato varchar(120),
        status varchar(10) NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','resgatada','baixada')),
        usuario_nome varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        resolvida_em timestamptz,
        resolvida_por varchar(120),
        forma_resgate varchar(20),
        turno_resgate_id uuid REFERENCES caixa_turnos(id) ON DELETE SET NULL,
        motivo_baixa varchar(300)
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_penhoras_abertas ON penhoras(empresa_id) WHERE status = 'aberta'`);
    await q.query(`ALTER TABLE caixa_turnos ADD COLUMN IF NOT EXISTS fundo_proximo numeric(10,2)`);
    await q.query(`ALTER TABLE caixa_turnos ADD COLUMN IF NOT EXISTS retirado numeric(10,2)`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["relatorios.ver"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'relatorios.ver'`);
    await q.query(`UPDATE perfis SET permissoes = permissoes || '["pagamentos.corrigir","penhoras.baixar"]'::jsonb WHERE nome = 'Gerente' AND NOT permissoes ? 'pagamentos.corrigir'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS penhoras`);
    await q.query(`ALTER TABLE caixa_turnos DROP COLUMN IF EXISTS fundo_proximo`);
    await q.query(`ALTER TABLE caixa_turnos DROP COLUMN IF EXISTS retirado`);
  }
}
