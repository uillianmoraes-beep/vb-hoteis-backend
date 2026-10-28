import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Planos por segmento (hospedagem e restaurante) e porte (Start, Plus, Master e Rede sob consulta)
 * e programa de parceiros: VB Indica (indicação), VB Revenda e VB Sua Marca (white-label).
 */
export class PlanosParceiros1761460000000 implements MigrationInterface {
  name = 'PlanosParceiros1761460000000';

  public async up(q: QueryRunner): Promise<void> {
    // mesa de restaurante/bar: conta aberta sem tarifa (só o consumo)
    await q.query(`ALTER TABLE estadias DROP CONSTRAINT IF EXISTS estadias_modalidade_check`);
    await q.query(`ALTER TABLE estadias ADD CONSTRAINT estadias_modalidade_check CHECK (modalidade IN ('periodo','pernoite','mesa'))`);
    await q.query(`ALTER TABLE planos ADD COLUMN IF NOT EXISTS segmento varchar(12) NOT NULL DEFAULT 'hospedagem'`);
    await q.query(`ALTER TABLE planos ADD COLUMN IF NOT EXISTS porte varchar(10) NOT NULL DEFAULT 'pequeno'`);
    await q.query(`ALTER TABLE planos ADD COLUMN IF NOT EXISTS sob_consulta boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE planos ADD COLUMN IF NOT EXISTS publico varchar(200)`);

    // os três planos de exemplo saem do site (quem já usa continua com eles)
    await q.query(`UPDATE planos SET ativo = false WHERE nome IN ('Essencial','Completo','Rede') AND NOT EXISTS (SELECT 1 FROM planos WHERE nome LIKE 'Start%')`);
    const [tem] = await q.query(`SELECT count(*)::int AS n FROM planos WHERE nome LIKE 'Start%'`);
    if (!Number(tem?.n)) {
      const H = (m: Record<string, boolean>) => JSON.stringify(m);
      const planos: [string, string, string, string, number, Record<string, boolean>, number | null, string[], boolean, boolean, number, string][] = [
        ['Start', 'hospedagem', 'pequeno', 'Para começar com o pé direito: recepção, suítes e caixa.', 149.9, { caixa: true, satisfacao: true }, 15,
          ['Mapa de suítes e quartos em tempo real', 'Entrada, conta e fechamento', 'Caixa e fechamento de turno', 'Tarifas por período e pernoite', 'Governança e limpeza', 'Relatórios do dia', 'Suporte pelo WhatsApp'], false, false, 1, 'Pequenos motéis, pousadas e hotéis'],
        ['Plus', 'hospedagem', 'medio', 'Controle completo da operação: estoque, notas e financeiro.', 299.9, { caixa: true, estoque: true, notas: true, restaurante: true, hotel: true, satisfacao: true }, 40,
          ['Tudo do Start', 'Estoque, compras e cozinha', 'Notas fiscais (NFC-e, NF-e, NFS-e)', 'Financeiro, DRE e conciliação', 'RH, escala e ponto com foto', 'Reservas online e WhatsApp com IA'], true, false, 2, 'Operações em crescimento'],
        ['Master', 'hospedagem', 'grande', 'Para operações grandes que querem tudo no automático.', 499.9, { caixa: true, estoque: true, notas: true, restaurante: true, hotel: true, satisfacao: true, manutencao: true }, 100,
          ['Tudo do Plus', 'App VB Manutenção', 'Servidor local (funciona sem internet)', 'Implantação assistida', 'Suporte prioritário'], false, false, 3, 'Hotéis e motéis de grande porte'],
        ['Rede', 'hospedagem', 'rede', 'Várias unidades com gestão central e condições sob medida.', 0, { caixa: true, estoque: true, notas: true, restaurante: true, hotel: true, satisfacao: true, manutencao: true }, null,
          ['Tudo do Master', 'Várias unidades e CNPJs', 'Relatórios consolidados', 'Implantação e treinamento no local', 'Gerente de conta dedicado'], false, true, 4, 'Redes e grupos'],
        ['Start', 'restaurante', 'pequeno', 'Mesas, comandas e caixa sem complicação.', 99.9, { caixa: true, restaurante: true, satisfacao: true }, null,
          ['Mesas e comandas', 'Pedido pelo celular do cliente (QR code)', 'Caixa e fechamento de turno', 'Garçom e gorjetas', 'Relatórios de vendas', 'Suporte pelo WhatsApp'], false, false, 1, 'Bares, lanchonetes e pequenos restaurantes'],
        ['Plus', 'restaurante', 'medio', 'Cozinha, estoque e nota fiscal integrados.', 199.9, { caixa: true, restaurante: true, estoque: true, notas: true, satisfacao: true }, null,
          ['Tudo do Start', 'Tela da cozinha e do bar', 'Estoque, compras e ficha técnica', 'NFC-e do consumo', 'Financeiro e conciliação', 'Controle de temperatura (Anvisa)'], true, false, 2, 'Restaurantes em crescimento'],
        ['Master', 'restaurante', 'grande', 'Gestão completa com equipe, custos e indicadores.', 349.9, { caixa: true, restaurante: true, estoque: true, notas: true, satisfacao: true, manutencao: true }, null,
          ['Tudo do Plus', 'RH, escala e ponto com foto', 'Precificação e lucro por prato', 'Servidor local (funciona sem internet)', 'Implantação assistida e suporte prioritário'], false, false, 3, 'Restaurantes de grande movimento'],
        ['Rede', 'restaurante', 'rede', 'Franquias e grupos com várias lojas.', 0, { caixa: true, restaurante: true, estoque: true, notas: true, satisfacao: true, manutencao: true }, null,
          ['Tudo do Master', 'Várias lojas e CNPJs', 'Relatórios consolidados', 'Cardápio e preços centralizados', 'Gerente de conta dedicado'], false, true, 4, 'Franquias e grupos'],
      ];
      for (const [nome, seg, porte, descricao, preco, modulos, limite, itens, destaque, consulta, ordem, publico] of planos) {
        await q.query(
          `INSERT INTO planos (nome, segmento, porte, descricao, preco, modulos, limite_unidades, itens, destaque, sob_consulta, ordem, publico)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12)`,
          [nome, seg, porte, descricao, preco.toFixed(2), H(modulos), limite, JSON.stringify(itens), destaque, consulta, ordem, publico]);
      }
    }

    await q.query(`
      CREATE TABLE IF NOT EXISTS parceiros (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tipo varchar(12) NOT NULL DEFAULT 'indicacao' CHECK (tipo IN ('indicacao','revenda','marca')),
        nome varchar(150) NOT NULL,
        responsavel varchar(120),
        documento varchar(20),
        email varchar(120),
        telefone varchar(20),
        cidade varchar(80),
        codigo varchar(20) NOT NULL UNIQUE,
        comissao_pct numeric(5,2) NOT NULL DEFAULT 20,
        desconto_pct numeric(5,2) NOT NULL DEFAULT 0,
        situacao varchar(10) NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente','ativo','inativo')),
        marca jsonb NOT NULL DEFAULT '{}'::jsonb,
        pix varchar(120),
        observacao text,
        mensagem text,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS parceiro_id uuid REFERENCES parceiros(id) ON DELETE SET NULL`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS parceiro_repasses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parceiro_id uuid NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
        competencia char(7) NOT NULL,
        valor numeric(10,2) NOT NULL,
        pago_em timestamptz NOT NULL DEFAULT now(),
        pago_por varchar(120),
        observacao varchar(200),
        UNIQUE (parceiro_id, competencia)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS parceiro_repasses`);
    await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS parceiro_id`);
    await q.query(`DROP TABLE IF EXISTS parceiros`);
    await q.query(`DELETE FROM planos WHERE nome IN ('Start','Plus','Master','Rede') AND segmento IN ('hospedagem','restaurante')`);
    for (const c of ['publico', 'sob_consulta', 'porte', 'segmento']) await q.query(`ALTER TABLE planos DROP COLUMN IF EXISTS ${c}`);
  }
}
