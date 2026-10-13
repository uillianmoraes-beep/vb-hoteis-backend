import { MigrationInterface, QueryRunner } from 'typeorm';

/** Integração com o app de manutenção da Virtual Barra: chamados abertos pelo hotel e o andamento das OS. */
export class ManutencaoVB1760690000000 implements MigrationInterface {
  name = 'ManutencaoVB1760690000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS integracao_manutencao jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS chamados_manutencao (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        unidade_id uuid,
        ambiente_id uuid,
        area varchar(30) NOT NULL,
        descricao varchar(2000) NOT NULL,
        local varchar(120),
        equipamento varchar(150),
        os_id uuid,
        protocolo varchar(12),
        status varchar(16) NOT NULL DEFAULT 'enviando',
        erro varchar(300),
        tecnico varchar(150),
        data_agendada timestamptz,
        concluida_em timestamptz,
        servico text,
        aviso_visto boolean NOT NULL DEFAULT false,
        criado_por varchar(120),
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_chamados_manutencao ON chamados_manutencao(empresa_id, criado_em DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS chamados_manutencao`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS integracao_manutencao`);
  }
}
