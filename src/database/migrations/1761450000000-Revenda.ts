import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revenda do sistema (SaaS): planos, situação de cada cliente (teste, ativa, atrasada, bloqueada), mensalidades,
 * suporte (chamados), erros do sistema, downloads, implantação e traduções (idiomas).
 * A empresa mais antiga do banco vira a "plataforma" (Virtual Barra), que administra a revenda.
 */
export class Revenda1761450000000 implements MigrationInterface {
  name = 'Revenda1761450000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plataforma boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE empresas SET plataforma = true WHERE id = (SELECT id FROM empresas ORDER BY criado_em LIMIT 1) AND NOT EXISTS (SELECT 1 FROM empresas WHERE plataforma)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plano_id uuid`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS situacao varchar(12) NOT NULL DEFAULT 'ativa'`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS teste_ate date`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dia_vencimento int NOT NULL DEFAULT 10`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS mensalidade_valor numeric(10,2)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS responsavel jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS origem varchar(12)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS asaas_cliente_revenda varchar(40)`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS idioma varchar(5) NOT NULL DEFAULT 'pt-BR'`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS implantacao jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS observacao_revenda text`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS planos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome varchar(60) NOT NULL,
        descricao varchar(400),
        preco numeric(10,2) NOT NULL DEFAULT 0,
        modulos jsonb NOT NULL DEFAULT '{}'::jsonb,
        limite_unidades int,
        itens jsonb NOT NULL DEFAULT '[]'::jsonb,
        destaque boolean NOT NULL DEFAULT false,
        ativo boolean NOT NULL DEFAULT true,
        ordem int NOT NULL DEFAULT 0,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    const [tem] = await q.query(`SELECT count(*)::int AS n FROM planos`);
    if (!Number(tem?.n)) {
      await q.query(`
        INSERT INTO planos (nome, descricao, preco, modulos, limite_unidades, itens, destaque, ordem) VALUES
        ('Essencial', 'Para começar: recepção, suítes, caixa e relatórios.', 149.90, '{"caixa":true,"satisfacao":true}', 15,
          '["Mapa das suítes e contas","Caixa e fechamento de turno","Tarifas e relatórios","Suporte pelo WhatsApp"]', false, 1),
        ('Completo', 'Motel ou hotel inteiro: estoque, cozinha, notas e financeiro.', 299.90, '{"caixa":true,"estoque":true,"notas":true,"restaurante":true,"hotel":true,"satisfacao":true}', 40,
          '["Tudo do Essencial","Estoque, compras e cozinha","Notas fiscais e contador","Financeiro, DRE e conciliação","RH, escala e ponto"]', true, 2),
        ('Rede', 'Mais de uma unidade ou mais de 40 suítes, com implantação assistida.', 549.90, '{"caixa":true,"estoque":true,"notas":true,"restaurante":true,"hotel":true,"satisfacao":true,"manutencao":true}', NULL,
          '["Tudo do Completo","Mais de uma unidade","App VB Manutenção","Implantação e treinamento no local"]', false, 3)`);
    }

    await q.query(`
      CREATE TABLE IF NOT EXISTS mensalidades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        competencia char(7) NOT NULL,
        descricao varchar(120),
        valor numeric(10,2) NOT NULL,
        vencimento date NOT NULL,
        situacao varchar(12) NOT NULL DEFAULT 'pendente',
        link varchar(300),
        linha varchar(60),
        pix_copia_cola text,
        pago_em timestamptz,
        forma_pagamento varchar(20),
        observacao varchar(200),
        criado_em timestamptz NOT NULL DEFAULT now(),
        UNIQUE (empresa_id, competencia)
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS suporte_chamados (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        numero serial,
        empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        assunto varchar(150) NOT NULL,
        categoria varchar(20) NOT NULL DEFAULT 'duvida',
        situacao varchar(12) NOT NULL DEFAULT 'aberto',
        tela varchar(150),
        criado_por varchar(120),
        lido_cliente boolean NOT NULL DEFAULT true,
        lido_suporte boolean NOT NULL DEFAULT false,
        criado_em timestamptz NOT NULL DEFAULT now(),
        atualizado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS suporte_mensagens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        chamado_id uuid NOT NULL REFERENCES suporte_chamados(id) ON DELETE CASCADE,
        autor varchar(10) NOT NULL,
        nome varchar(120),
        texto text NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_suporte_mensagens ON suporte_mensagens(chamado_id, criado_em)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS erros_sistema (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        assinatura varchar(64) NOT NULL UNIQUE,
        origem varchar(10) NOT NULL,
        mensagem varchar(500) NOT NULL,
        detalhe text,
        tela varchar(200),
        empresas uuid[] NOT NULL DEFAULT '{}',
        ultima_empresa_id uuid,
        ultimo_usuario varchar(120),
        vezes int NOT NULL DEFAULT 1,
        primeiro_em timestamptz NOT NULL DEFAULT now(),
        ultimo_em timestamptz NOT NULL DEFAULT now(),
        resolvido boolean NOT NULL DEFAULT false,
        solucao text
      )`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS downloads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        categoria varchar(20) NOT NULL,
        nome varchar(120) NOT NULL,
        descricao varchar(400),
        url varchar(500),
        arquivo varchar(200),
        arquivo_nome varchar(150),
        tamanho bigint,
        versao varchar(30),
        publico boolean NOT NULL DEFAULT false,
        ativo boolean NOT NULL DEFAULT true,
        ordem int NOT NULL DEFAULT 0,
        criado_em timestamptz NOT NULL DEFAULT now()
      )`);

    const [temDl] = await q.query(`SELECT count(*)::int AS n FROM downloads`);
    if (!Number(temDl?.n)) {
      const lista: [string, string, string, string, boolean, number][] = [
        ['instalador', 'Agente de impressão VB', 'Programa que manda as impressões do sistema para a impressora da recepção. Veja o passo a passo em Ajustes › Impressoras.', '/agente/vb-agente-impressao.js', false, 1],
        ['instalador', 'Node.js (necessário para o agente de impressão)', 'Instale a versão LTS no computador da impressora.', 'https://nodejs.org/pt', true, 2],
        ['reparo', 'Reparo da impressão (limpa a fila travada)', 'Clique com o botão direito e escolha "Executar como administrador". Para e liga de novo o serviço de impressão do Windows.', '/agente/reparar-impressao.bat', true, 1],
        ['reparo', 'Reparo da internet (limpa o DNS)', 'Resolve quando o sistema não abre mas a internet funciona. Execute como administrador.', '/agente/reparar-internet.bat', true, 2],
        ['impressoras', 'Epson (TM-T20, TM-T88 e outras)', 'Site oficial de suporte da Epson: procure o modelo e baixe o driver.', 'https://epson.com.br/Suporte/Impressoras/sh/s1', true, 1],
        ['impressoras', 'Elgin (i7, i8, i9 e outras)', 'Site oficial da Elgin, área de automação comercial.', 'https://www.elgin.com.br/automacao-comercial', true, 2],
        ['impressoras', 'Control iD (Print iD)', 'Página oficial de suporte e downloads da Control iD.', 'https://www.controlid.com.br/suporte/', true, 3],
        ['impressoras', 'Tanca', 'Site oficial da Tanca.', 'https://www.tanca.com.br/', true, 4],
        ['impressoras', 'Sweda', 'Site oficial da Sweda.', 'https://sweda.com.br/', true, 5],
        ['impressoras', 'Zebra (etiquetas)', 'Suporte oficial da Zebra: drivers das impressoras de etiqueta.', 'https://support.zebra.com/pt-BR/', true, 6],
        ['programas', 'Google Chrome', 'Navegador recomendado para usar o sistema.', 'https://www.google.com/intl/pt-BR/chrome/', true, 1],
        ['programas', 'AnyDesk (acesso remoto do suporte)', 'Para a equipe da Virtual Barra acessar o computador e ajudar.', 'https://anydesk.com/pt/downloads/windows', true, 2],
        ['programas', 'RustDesk (acesso remoto gratuito)', 'Alternativa gratuita para o acesso remoto do suporte.', 'https://rustdesk.com/', true, 3],
        ['programas', 'TeamViewer', 'Outra opção de acesso remoto.', 'https://www.teamviewer.com/pt-br/download/windows/', true, 4],
        ['programas', 'Adobe Acrobat Reader', 'Abrir e imprimir PDF (notas, relatórios, boletos).', 'https://get.adobe.com/br/reader/', true, 5],
        ['programas', '7-Zip', 'Abrir arquivos compactados (.zip, .rar).', 'https://www.7-zip.org/', true, 6],
        ['manuais', 'Manual do sistema', 'Manual completo com o passo a passo de cada tela.', '/manual', false, 1],
      ];
      for (const [categoria, nome, descricao, url, publico, ordem] of lista) {
        await q.query(`INSERT INTO downloads (categoria, nome, descricao, url, publico, ordem) VALUES ($1,$2,$3,$4,$5,$6)`, [categoria, nome, descricao, url, publico, ordem]);
      }
    }

    await q.query(`
      CREATE TABLE IF NOT EXISTS revenda_config (
        id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        teste_dias int NOT NULL DEFAULT 14,
        dias_aviso int NOT NULL DEFAULT 3,
        dias_bloqueio int NOT NULL DEFAULT 15,
        whatsapp varchar(20),
        email varchar(120),
        textos jsonb NOT NULL DEFAULT '{}'::jsonb
      )`);
    await q.query(`INSERT INTO revenda_config (id) VALUES (1) ON CONFLICT DO NOTHING`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS traducoes (
        hash varchar(64) NOT NULL,
        idioma varchar(5) NOT NULL,
        texto text NOT NULL,
        traducao text NOT NULL,
        empresa_id uuid,
        criado_em timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (hash, idioma)
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const t of ['traducoes', 'revenda_config', 'downloads', 'erros_sistema', 'suporte_mensagens', 'suporte_chamados', 'mensalidades', 'planos']) await q.query(`DROP TABLE IF EXISTS ${t}`);
    for (const c of ['observacao_revenda', 'implantacao', 'idioma', 'asaas_cliente_revenda', 'origem', 'responsavel', 'mensalidade_valor', 'dia_vencimento', 'teste_ate', 'situacao', 'plano_id', 'plataforma']) {
      await q.query(`ALTER TABLE empresas DROP COLUMN IF EXISTS ${c}`);
    }
  }
}
