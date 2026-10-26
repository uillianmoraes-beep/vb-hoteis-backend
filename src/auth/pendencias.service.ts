import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken, temPermissao } from '../common/permissoes';
import { FeriasService } from '../funcionarios/ferias';
import { EscalaService } from '../funcionarios/escala';
import { LicencasService } from '../funcionarios/licencas';
import { BancoHorasService } from '../funcionarios/banco-horas';
import { AreaContadorService } from '../contador/area';
import { LeitorContadorService } from '../contador/leitor';
import { ContratosService } from '../contratos/contratos';

export interface Pendencia {
  chave: string;
  /** alerta = resolver agora · aviso = hoje · info = só para saber */
  nivel: 'alerta' | 'aviso' | 'info';
  titulo: string;
  detalhe?: string;
  quantidade: number;
  /** tela onde resolve */
  link: string;
}

const HOJE = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;

/**
 * Pendências mostradas logo depois do login (e no sino do topo): o que ficou para trás
 * e o que precisa de atenção hoje no ambiente em que a pessoa entrou.
 * Cada item só aparece para quem tem a permissão de resolver.
 */
@Injectable()
export class PendenciasService {
  constructor(private readonly ds: DataSource) {}

  async listar(u: UsuarioToken, ambienteId?: string): Promise<Pendencia[]> {
    const pode = (...p: string[]) => p.some((x) => temPermissao(u, x));
    const amb = ambienteId && /^[0-9a-f-]{36}$/i.test(ambienteId) ? ambienteId : null;
    // ambientes que o usuário enxerga
    const permitidos = u.ambientesIds?.length ? u.ambientesIds : null;
    const out: Pendencia[] = [];

    /** roda uma contagem; erro em uma não derruba as outras */
    const contar = async (sql: string, params: unknown[]): Promise<{ n: number; nomes: string }> => {
      try {
        const [r] = await this.ds.query(sql, params);
        return { n: Number(r?.n ?? 0), nomes: r?.nomes ?? '' };
      } catch {
        return { n: 0, nomes: '' };
      }
    };
    /** filtro de ambiente para uma coluna (ambiente atual ou os permitidos) */
    const filtroAmb = (col: string, params: unknown[]) => {
      if (amb) { params.push(amb); return ` AND ${col} = $${params.length}::uuid`; }
      if (permitidos) { params.push(permitidos); return ` AND ${col} = ANY($${params.length}::uuid[])`; }
      return '';
    };
    const add = (p: Omit<Pendencia, 'quantidade'>, r: { n: number; nomes: string }, comNomes = true) => {
      if (r.n > 0) out.push({ ...p, quantidade: r.n, detalhe: [p.detalhe, comNomes && r.nomes ? r.nomes : ''].filter(Boolean).join(' · ') || undefined });
    };
    const lista = (expr: string) => `string_agg(DISTINCT ${expr}, ', ')`;

    if (pode('reservas.gerenciar', 'estadias.operar', 'funcionarios.gerenciar')) {
      // aniversariante hoje (hóspede pela ficha FNRH, funcionário pelo cadastro)
      add({ chave: 'aniversario-hoje', nivel: 'info', titulo: 'Aniversariantes de hoje', detalhe: 'mande os parabéns', link: '/aniversariantes' },
        await contar(`SELECT count(*) AS n, string_agg(DISTINCT nome, ', ') AS nomes FROM (
            SELECT f.dados->>'nome' AS nome FROM fichas_hospede f WHERE f.empresa_id = $1 AND f.dados->>'nascimento' ~ '^\\d{4}-\\d{2}-\\d{2}$'
              AND substr(f.dados->>'nascimento', 6, 5) = to_char(${HOJE}, 'MM-DD')
            UNION SELECT nome FROM funcionarios WHERE empresa_id = $1 AND ativo AND to_char(nascimento, 'MM-DD') = to_char(${HOJE}, 'MM-DD')) x`, [u.empresaId]));
    }

    if (pode('funcionarios.gerenciar')) {
      // documento do funcionário com validade (exame ASO, CNH) vencido ou vencendo em 30 dias; vale só o mais novo de cada tipo
      add({ chave: 'documentos-vencendo', nivel: 'aviso', titulo: 'Documentos de funcionário vencendo', detalhe: 'exame médico, CNH…', link: '/funcionarios' },
        await contar(`SELECT count(*) AS n, string_agg(DISTINCT f.nome, ', ') AS nomes FROM funcionario_documentos d JOIN funcionarios f ON f.id = d.funcionario_id
            WHERE d.empresa_id = $1 AND f.ativo AND d.validade IS NOT NULL AND d.validade <= ${HOJE} + 30
              AND NOT EXISTS (SELECT 1 FROM funcionario_documentos n WHERE n.funcionario_id = d.funcionario_id AND n.tipo = d.tipo AND n.criado_em > d.criado_em)`, [u.empresaId]));
    }

    if (pode('funcionarios.gerenciar', 'funcionarios.financeiro')) {
      // férias vencidas (pagam em dobro) ou que precisam começar em até 60 dias e ninguém programou
      try {
        const nomes = await new FeriasService(this.ds).alertas(u.empresaId);
        add({ chave: 'ferias-vencendo', nivel: 'alerta', titulo: 'Férias vencidas ou perto de vencer', detalhe: 'programe para não pagar em dobro', link: '/rh' },
          { n: nomes.length, nomes: nomes.slice(0, 5).join(', ') });
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('funcionarios.gerenciar')) {
      // de quinta a domingo: quem costuma estar na escala e ainda não tem a da semana que vem
      try {
        const r = await new EscalaService(this.ds).semEscalaProximaSemana(u.empresaId);
        add({ chave: 'escala-proxima-semana', nivel: 'aviso', titulo: 'Escala da semana que vem sem montar', detalhe: `a partir de ${r.segunda}`, link: '/escala' },
          { n: r.nomes.length, nomes: r.nomes.slice(0, 5).join(', ') });
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('funcionarios.gerenciar', 'funcionarios.financeiro')) {
      // licença terminando (preparar a volta) e afastado do INSS sem data de volta
      try {
        const l = await new LicencasService(this.ds).avisos(u.empresaId);
        add({ chave: 'licencas-volta', nivel: 'info', titulo: 'Funcionário voltando de licença', link: '/funcionarios' }, { n: l.length, nomes: l.slice(0, 5).join(', ') });
      } catch { /* tabelas novas ainda não criadas */ }
      // banco de horas: horas vencidas (têm que ser pagas) ou vencendo em 30 dias
      try {
        const b = await new BancoHorasService(this.ds, new EscalaService(this.ds)).avisos(u.empresaId);
        add({ chave: 'banco-horas-vencendo', nivel: 'aviso', titulo: 'Banco de horas vencendo', detalhe: 'dê a folga ou pague as horas', link: '/escala?aba=banco' }, { n: b.length, nomes: b.slice(0, 5).join(', ') });
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('ferramentas.gerenciar', 'compras.gerenciar', 'caixa.adm', 'unidades.bloquear')) {
      // ferramentas: devolução atrasada (para quem cuida) e pedidos de compra esperando a pré-aprovação (compras/ADM)
      try {
        const f = await this.ds.query(
          `SELECT (SELECT count(*) FROM ferramenta_entregas WHERE empresa_id = $1 AND devolvida_em IS NULL AND previsao < ${HOJE})::int AS atrasadas,
                  (SELECT string_agg(DISTINCT responsavel, ', ') FROM ferramenta_entregas WHERE empresa_id = $1 AND devolvida_em IS NULL AND previsao < ${HOJE}) AS quem,
                  (SELECT count(*) FROM ferramenta_pedidos WHERE empresa_id = $1 AND status = 'pendente')::int AS pedidos`, [u.empresaId]);
        if (pode('ferramentas.gerenciar')) add({ chave: 'ferramentas-atrasadas', nivel: 'aviso', titulo: 'Ferramentas com devolução atrasada', link: '/ferramentas' }, { n: f[0]?.atrasadas ?? 0, nomes: f[0]?.quem ?? '' });
        if (pode('compras.gerenciar', 'caixa.adm')) add({ chave: 'ferramentas-pedidos', nivel: 'aviso', titulo: 'Pedidos de ferramenta para aprovar', detalhe: 'aprovado já vira cotação', link: '/ferramentas?aba=pedidos' }, { n: f[0]?.pedidos ?? 0, nomes: '' }, false);
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('reservas.gerenciar')) {
      // reserva online começada e não terminada (últimas 48 h), ainda sem ninguém chamar
      try {
        const ab = await this.ds.query(
          `SELECT count(*)::int AS n, string_agg(COALESCE(nome, telefone), ', ') AS quem FROM reservas_rascunhos
            WHERE empresa_id = $1 AND reserva_id IS NULL AND contatado_em IS NULL AND atualizado_em BETWEEN now() - interval '48 hours' AND now() - interval '20 minutes'`, [u.empresaId]);
        add({ chave: 'reservas-abandonadas', nivel: 'info', titulo: 'Reserva online não terminada', detalhe: 'chame no WhatsApp', link: '/promocoes?aba=abandonadas' }, { n: ab[0]?.n ?? 0, nomes: ab[0]?.quem ?? '' });
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('uniformes.gerenciar')) {
      // uniformes e EPI: troca vencida, estoque abaixo do mínimo, CA do EPI vencido
      try {
        const w = await this.ds.query(
          `SELECT (SELECT count(*) FROM uniforme_entregas WHERE empresa_id = $1 AND devolvido_em IS NULL AND troca_prevista < ${HOJE})::int AS trocas,
                  (SELECT count(*) FROM uniforme_itens WHERE empresa_id = $1 AND ativo AND estoque_minimo > 0 AND quantidade < estoque_minimo)::int AS minimo,
                  (SELECT count(*) FROM uniforme_itens WHERE empresa_id = $1 AND ativo AND ca_validade < ${HOJE})::int AS ca`, [u.empresaId]);
        add({ chave: 'uniformes-troca', nivel: 'info', titulo: 'Uniforme/EPI na hora de trocar', link: '/uniformes?aba=entregas' }, { n: w[0]?.trocas ?? 0, nomes: '' });
        add({ chave: 'uniformes-minimo', nivel: 'aviso', titulo: 'Uniforme/EPI abaixo do mínimo', detalhe: 'compre mais', link: '/uniformes' }, { n: w[0]?.minimo ?? 0, nomes: '' });
        add({ chave: 'uniformes-ca', nivel: 'aviso', titulo: 'EPI com CA vencido', detalhe: 'troque por um com certificado válido', link: '/uniformes' }, { n: w[0]?.ca ?? 0, nomes: '' });
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('caixa.adm', 'funcionarios.gerenciar')) {
      // do dia 15 em diante: o que o contador ainda não entregou do mês passado
      try {
        const c = await new AreaContadorService(this.ds, new LeitorContadorService()).faltando(u.empresaId);
        add({ chave: 'contador-faltando', nivel: 'aviso', titulo: 'O contador ainda não entregou', detalhe: c.competencia ? `mês ${c.competencia.split('-').reverse().join('/')}` : undefined, link: '/contador?aba=entregas' },
          { n: c.nomes.length, nomes: c.nomes.join(', ') });
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('contratos.gerenciar')) {
      // contratos: esperando a assinatura do outro lado há mais de 3 dias, e os que acabam em 30 dias
      try {
        const c = await new ContratosService(this.ds).avisos(u.empresaId);
        add({ chave: 'contratos-assinatura', nivel: 'info', titulo: 'Contratos esperando assinatura', detalhe: 'mandados há mais de 3 dias', link: '/contratos?status=aguardando' }, { n: c.esperando, nomes: '' }, false);
        add({ chave: 'contratos-vencendo', nivel: 'aviso', titulo: 'Contratos acabando em 30 dias', detalhe: 'renove ou faça um aditivo', link: '/contratos?status=ativo' }, { n: c.vencendo, nomes: '' }, false);
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('caixa.adm')) {
      // reserva do caixa ADM: perguntar quanto separar do movimento de ontem (enquanto não responder) e avisar atraso
      try {
        const [r] = await this.ds.query(
          `SELECT (SELECT count(*) FROM reserva_compromissos WHERE empresa_id = $1 AND ativo)::int AS compromissos,
                  (SELECT count(*) FROM reserva_movimentos WHERE empresa_id = $1 AND data = ${HOJE} - 1 AND tipo IN ('separar','pular'))::int AS respondido`, [u.empresaId]);
        if (r?.compromissos > 0 && !r.respondido) {
          out.push({ chave: 'reserva-separar', nivel: 'aviso', titulo: 'Separar a reserva do movimento de ontem', quantidade: 1,
            detalhe: 'quanto vai para o fundo das despesas do mês (folha, contas, impostos)', link: '/reserva' });
        }
      } catch { /* tabelas novas ainda não criadas */ }
    }

    if (pode('despesas.aprovar')) {
      add({ chave: 'contas-aprovar', nivel: 'aviso', titulo: 'Contas a pagar esperando aprovação', detalhe: 'notas e boletos lançados pelo setor de compras', link: '/despesas?aba=aprovacao' },
        await contar(`SELECT count(DISTINCT COALESCE(lote_id, id)) AS n, ${lista('fornecedor')} AS nomes FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND aprovacao = 'pendente'`, [u.empresaId]));
    } else if (pode('despesas.gerenciar', 'compras.gerenciar')) {
      add({ chave: 'contas-recusadas', nivel: 'alerta', titulo: 'Contas recusadas pelo financeiro', detalhe: 'corrija e salve de novo', link: '/despesas?aba=aprovacao' },
        await contar(`SELECT count(DISTINCT COALESCE(lote_id, id)) AS n, ${lista('fornecedor')} AS nomes FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND aprovacao = 'recusada' AND criado_por = $2`, [u.empresaId, u.nome]));
    }

    if (pode('estoque.gerenciar')) {
      // mercadoria que voltou ao estoque por item cancelado: avisa até o estoquista conferir
      add({ chave: 'devolucoes-estoque', nivel: 'aviso', titulo: 'Itens que voltaram ao estoque', detalhe: 'itens cancelados nas contas: confira se a mercadoria voltou mesmo', link: '/relatorios/estornos?aba=devolucoes' },
        await contar(`SELECT count(*) AS n, ${lista('pr.nome')} AS nomes FROM estoque_movimentos m JOIN produtos pr ON pr.id = m.produto_id
          WHERE m.empresa_id = $1 AND m.tipo = 'estorno' AND m.conferido_em IS NULL`, [u.empresaId]));
    }

    if (pode('notas.gerenciar', 'empresa.editar')) {
      // certificado digital: vermelho na última semana (ou vencido), amarelo até 30 dias antes
      try {
        const certs: { titular: string; tipo: string; dias: number }[] = await this.ds.query(
          `SELECT titular, tipo, (validade - ${HOJE})::int AS dias FROM certificados WHERE empresa_id = $1 AND ativo AND validade <= ${HOJE} + 30 ORDER BY validade`, [u.empresaId]);
        const quando = (d: number) => (d < 0 ? `venceu há ${-d} dia(s)` : d === 0 ? 'vence hoje' : `vence em ${d} dia(s)`);
        const urgentes = certs.filter((c) => c.dias <= 7);
        const proximos = certs.filter((c) => c.dias > 7);
        if (urgentes.length) out.push({ chave: 'certificado-urgente', nivel: 'alerta', titulo: 'Certificado digital vencendo', quantidade: urgentes.length,
          detalhe: urgentes.map((c) => `${c.tipo} ${c.titular}: ${quando(c.dias)}`).join(' · ') + ' · sem ele não sai nota fiscal', link: '/certificados' });
        if (proximos.length) out.push({ chave: 'certificado-proximo', nivel: 'aviso', titulo: 'Certificado digital vence este mês', quantidade: proximos.length,
          detalhe: proximos.map((c) => `${c.tipo} ${c.titular}: ${quando(c.dias)}`).join(' · '), link: '/certificados' });
      } catch { /* tabela nova ainda não criada */ }
    }

    if (pode('painel.ver', 'reservas.gerenciar', 'estadias.operar')) {
      // hotel: hóspede que já devia ter saído
      let p: unknown[] = [u.empresaId];
      add({ chave: 'saidas-atrasadas', nivel: 'alerta', titulo: 'Hóspedes com saída vencida', detalhe: 'a data de saída já passou e a conta continua aberta', link: '/painel' },
        await contar(`SELECT count(*) AS n, ${lista('un.codigo')} AS nomes FROM estadias e JOIN unidades un ON un.id = e.unidade_id
          WHERE e.empresa_id = $1 AND e.status IN ('aberta','conta_entregue') AND e.saida_prevista < ${HOJE}${filtroAmb('e.ambiente_id', p)}`, p));
      p = [u.empresaId];
      add({ chave: 'saidas-hoje', nivel: 'aviso', titulo: 'Saídas previstas para hoje', link: '/painel' },
        await contar(`SELECT count(*) AS n, ${lista('un.codigo')} AS nomes FROM estadias e JOIN unidades un ON un.id = e.unidade_id
          WHERE e.empresa_id = $1 AND e.status IN ('aberta','conta_entregue') AND e.saida_prevista = ${HOJE}${filtroAmb('e.ambiente_id', p)}`, p));
      // despertador que passou da hora
      p = [u.empresaId];
      add({ chave: 'despertadores', nivel: 'alerta', titulo: 'Despertadores atrasados', link: '/painel' },
        await contar(`SELECT count(*) AS n, ${lista('un.codigo')} AS nomes FROM despertadores d JOIN unidades un ON un.id = d.unidade_id
          WHERE d.empresa_id = $1 AND d.status = 'pendente' AND d.horario < now()${filtroAmb('un.ambiente_id', p)}`, p));
      // limpeza demorando e unidades bloqueadas
      p = [u.empresaId];
      add({ chave: 'limpeza-demorada', nivel: 'aviso', titulo: 'Em limpeza há mais de 1h30', link: '/governanca' },
        await contar(`SELECT count(*) AS n, ${lista('un.codigo')} AS nomes FROM unidades un
          WHERE un.empresa_id = $1 AND un.ativo AND un.status = 'limpeza' AND un.status_desde < now() - interval '90 minutes'${filtroAmb('un.ambiente_id', p)}`, p));
      p = [u.empresaId];
      add({ chave: 'bloqueadas', nivel: 'info', titulo: 'Unidades bloqueadas', link: '/painel' },
        await contar(`SELECT count(*) AS n, ${lista('un.codigo')} AS nomes FROM unidades un
          WHERE un.empresa_id = $1 AND un.ativo AND un.status = 'bloqueada'${filtroAmb('un.ambiente_id', p)}`, p));
      // manutenção
      p = [u.empresaId];
      add({ chave: 'manutencao-erro', nivel: 'alerta', titulo: 'Chamados de manutenção que não foram enviados', detalhe: 'abra Manutenção e reenvie', link: '/manutencao' },
        await contar(`SELECT count(*) AS n, '' AS nomes FROM chamados_manutencao c WHERE c.empresa_id = $1 AND c.status = 'erro'${filtroAmb('c.ambiente_id', p)}`, p), false);
      p = [u.empresaId];
      add({ chave: 'manutencao-abertos', nivel: 'info', titulo: 'Chamados de manutenção em aberto', link: '/manutencao' },
        await contar(`SELECT count(*) AS n, '' AS nomes FROM chamados_manutencao c WHERE c.empresa_id = $1 AND c.status NOT IN ('concluida','cancelada','removida','erro')${filtroAmb('c.ambiente_id', p)}`, p), false);
    }

    if (pode('reservas.gerenciar', 'painel.ver')) {
      let p: unknown[] = [u.empresaId];
      add({ chave: 'reservas-pendentes', nivel: 'alerta', titulo: 'Reservas aguardando confirmação', detalhe: 'pedidos novos (site / telefone)', link: '/reservas' },
        await contar(`SELECT count(*) AS n, ${lista('r.hospede')} AS nomes FROM reservas r WHERE r.empresa_id = $1 AND r.status = 'pendente' AND r.saida >= ${HOJE}${filtroAmb('r.ambiente_id', p)}`, p));
      p = [u.empresaId];
      add({ chave: 'reservas-noshow', nivel: 'alerta', titulo: 'Reservas com chegada vencida', detalhe: 'faça o check-in ou marque não compareceu', link: '/reservas' },
        await contar(`SELECT count(*) AS n, ${lista('r.hospede')} AS nomes FROM reservas r WHERE r.empresa_id = $1 AND r.status IN ('pendente','confirmada') AND r.chegada < ${HOJE}${filtroAmb('r.ambiente_id', p)}`, p));
      p = [u.empresaId];
      add({ chave: 'reservas-hoje', nivel: 'aviso', titulo: 'Chegadas de hoje', link: '/reservas' },
        await contar(`SELECT count(*) AS n, ${lista('r.hospede')} AS nomes FROM reservas r WHERE r.empresa_id = $1 AND r.status IN ('pendente','confirmada') AND r.chegada = ${HOJE}${filtroAmb('r.ambiente_id', p)}`, p));
    }

    if (pode('estadias.operar')) {
      const p: unknown[] = [u.empresaId];
      add({ chave: 'pedidos', nivel: 'alerta', titulo: 'Pedidos da comanda esperando', link: '/comanda' },
        await contar(`SELECT count(*) AS n, ${lista('un.codigo')} AS nomes FROM pedidos x JOIN unidades un ON un.id = x.unidade_id
          WHERE x.empresa_id = $1 AND x.status = 'novo'${filtroAmb('un.ambiente_id', p)}`, p));
    }

    if (pode('caixa.principal', 'caixa.adm')) {
      let p: unknown[] = [u.empresaId];
      add({ chave: 'caixa-antigo', nivel: 'alerta', titulo: 'Caixa aberto há mais de 24 horas', detalhe: 'confira e feche o turno', link: '/caixa' },
        await contar(`SELECT count(*) AS n, ${lista(`a.nome || ' (turno ' || t.numero || ')'`)} AS nomes FROM caixa_turnos t JOIN ambientes a ON a.id = t.ambiente_id
          WHERE t.empresa_id = $1 AND t.status = 'aberto' AND t.aberto_em < now() - interval '24 hours'${filtroAmb('t.ambiente_id', p)}`, p));
      p = [u.empresaId];
      add({ chave: 'penhoras', nivel: 'info', titulo: 'Penhoras em aberto', detalhe: 'objetos esperando o cliente voltar para pagar', link: '/penhoras' },
        await contar(`SELECT count(*) AS n, '' AS nomes FROM penhoras x WHERE x.empresa_id = $1 AND x.status = 'aberta'${filtroAmb('x.ambiente_id', p)}`, p), false);
    }

    if (pode('notas.gerenciar')) {
      const p: unknown[] = [u.empresaId];
      add({ chave: 'notas', nivel: 'aviso', titulo: 'Notas fiscais para emitir', link: '/notas' },
        await contar(`SELECT count(*) AS n, '' AS nomes FROM estadia_notas n JOIN estadias e ON e.id = n.estadia_id
          WHERE n.empresa_id = $1 AND n.status = 'pendente'${filtroAmb('e.ambiente_id', p)}`, p), false);
    }

    if (pode('despesas.gerenciar')) {
      add({ chave: 'pagar-vencidas', nivel: 'alerta', titulo: 'Contas a pagar vencidas', link: '/despesas' },
        await contar(`SELECT count(*) AS n, '' AS nomes FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND vencimento < ${HOJE}`, [u.empresaId]), false);
      add({ chave: 'pagar-hoje', nivel: 'aviso', titulo: 'Contas a pagar vencendo hoje', link: '/despesas' },
        await contar(`SELECT count(*) AS n, ${lista('descricao')} AS nomes FROM contas_pagar WHERE empresa_id = $1 AND status = 'aberta' AND vencimento = ${HOJE}`, [u.empresaId]));
    }

    if (pode('faturamento.gerenciar')) {
      add({ chave: 'receber-vencidas', nivel: 'aviso', titulo: 'Contas a receber vencidas', detalhe: 'clientes faturados em atraso', link: '/faturamento' },
        await contar(`SELECT count(*) AS n, '' AS nomes FROM contas_receber WHERE empresa_id = $1 AND status = 'aberta' AND vencimento < ${HOJE}`, [u.empresaId]), false);
    }

    if (pode('estoque.gerenciar', 'compras.gerenciar')) {
      const p: unknown[] = [u.empresaId];
      const w = amb ? (p.push(amb), ` AND (l.ambiente_id IS NULL OR l.ambiente_id = $2::uuid)`) : '';
      add({ chave: 'estoque-minimo', nivel: 'aviso', titulo: 'Produtos abaixo do estoque mínimo', detalhe: 'veja em Estoque › Saldos ou monte uma cotação', link: '/estoque' },
        await contar(`SELECT count(DISTINCT s.produto_id) AS n, '' AS nomes FROM estoque_saldos s JOIN estoque_locais l ON l.id = s.local_id
          WHERE l.empresa_id = $1 AND l.ativo AND s.minimo > 0 AND s.quantidade < s.minimo${w}`, p), false);
    }

    const ordem = { alerta: 0, aviso: 1, info: 2 };
    return out.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);
  }
}
