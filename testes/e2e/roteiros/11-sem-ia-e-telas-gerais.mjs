// Servidor sem ANTHROPIC_API_KEY: a busca de tributação (NCM) e o assistente avisam, sem erro 500.
// E uma passada pelas telas de leitura mais usadas, conferindo que nenhuma dá erro interno.
import { verifica, status } from '../lib.mjs';

export default async function (ctx) {
  const adm = ctx.admin;

  const ncm = await adm.get(`/fiscal/ncm?q=${encodeURIComponent('cerveja')}`);
  // o portal do governo para todo dia das 01:00 às 03:00: nesse horário o certo é um aviso (503), não erro interno
  if (ncm.status === 503 && /parada programada/i.test(ncm.json?.message ?? '')) {
    verifica('busca de NCM com o governo em manutenção dá aviso (503), sem erro interno', true);
  } else {
    status('busca de tributação (NCM) funciona sem IA', ncm, 200);
    verifica('sem IA a busca ainda acha NCM pela tabela oficial', JSON.stringify(ncm.json).includes('2203'), JSON.stringify(ncm.json).slice(0, 300));
  }
  const ass = await adm.post('/assistente', { pergunta: 'Quanto vendi hoje?' });
  verifica('assistente sem IA avisa que não está ligado (503, sem erro 500)', ass.status === 503 && /intelig/i.test(ass.json?.message ?? ''), ass);

  const telas = [
    '/empresa', '/auth/pendencias', '/auth/seguranca', '/painel/atividades', '/categorias', '/motivos-bloqueio', '/cortesias',
    '/relatorios/ocupacao-categoria', '/relatorios/desempenho', '/relatorios/estornos', '/gorjetas', '/penhoras', '/caixa/config',
    '/notas/config', '/fiscal/regras', '/plano-contas', '/bens', '/eventos', '/enxoval', '/cafe', '/vistorias',
    '/manutencao', '/contratos', '/uniformes', '/ferramentas', '/avaliacoes', '/backup', '/area-cliente',
  ];
  for (const t of telas) {
    const r = await adm.get(t);
    verifica(`tela ${t} abre sem erro interno`, r.status < 500, `${r.status}: ${r.texto.slice(0, 200)}`);
  }
  // nenhum erro inesperado ficou registrado para a Virtual Barra durante a rodada
  const erros = await adm.get('/revenda/erros?todos=1');
  const lista = erros.json?.erros ?? erros.json ?? [];
  verifica('nenhum erro 500 registrado no servidor durante os testes', Array.isArray(lista) && lista.length === 0, Array.isArray(lista) ? lista.slice(0, 5).map((e) => `${e.metodo ?? ''} ${e.rota ?? e.caminho ?? ''} ${e.mensagem ?? ''}`) : lista);
}
