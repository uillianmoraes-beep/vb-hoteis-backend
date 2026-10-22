/**
 * Catálogo de permissões. O perfil Administrador recebe '*' (tudo).
 * Novas permissões entram aqui conforme os módulos forem chegando.
 */
export const PERMISSOES = {
  'painel.ver': 'Ver o Painel de Unidades',
  'cozinha.ver': 'Tela da cozinha/bar: ver e marcar os pedidos (preparando, pronto, entregue)',
  'unidades.status': 'Mudar status das unidades (limpeza, vistoria, livre)',
  'unidades.bloquear': 'Bloquear unidade com motivo',
  'unidades.desbloquear': 'Desbloquear unidade',
  'unidades.gerenciar': 'Cadastrar e editar unidades',
  'reservas.gerenciar': 'Reservas do hotel: criar, alterar, cancelar e fazer o check-in',
  'governanca.operar': 'Tela da governança (limpeza, vistoria, camareiras)',
  'enxoval.gerenciar': 'Enxoval: tipos de peça, kits, compras (lotes com QR), lavanderia, perdas com foto e assinar como responsável',
  'enxoval.aprovar': 'Enxoval: ver tudo e assinar o relatório como gerente',
  'estadias.operar': 'Dar entrada, entregar e fechar contas',
  'estadias.entrada': 'Dar entrada e receber na entrada (portaria)',
  'saida.registrar': 'Portão de saída: conferir o ticket de liberação',
  'estadias.cancelar': 'Cancelar uma entrada já feita',
  'tarifas.gerenciar': 'Configurar períodos, preços e regras de cobrança',
  'estadias.corrigir': 'Corrigir hora de entrada e tabela de uma conta',
  'estadias.estornar': 'Estornar item lançado na conta',
  'cortesias.gerenciar': 'Cadastrar cortesias (30%, 50%, 100%…) e liberar as que pedem senha',
  'pagamentos.corrigir': 'Mudar a forma de pagamento já lançada (ex.: débito que foi pix)',
  'produtos.gerenciar': 'Cadastrar produtos e serviços',
  'compras.gerenciar': 'Compras: fornecedores, cotações de preço e pedidos de compra',
  'estoque.gerenciar': 'Estoque: locais (centros de custo), entrada de notas, transferência, inventário e relatórios',
  'avaliacoes.ver': 'Ver o relatório de satisfação dos clientes',
  'caixa.principal': 'Caixa principal: abrir, receber, reforço, despesa e fechar o próprio turno',
  'caixa.sangria': 'Fazer sangria sem pedir senha',
  'caixa.adm': 'Caixa ADM (gerência): ver e lançar',
  'faturamento.gerenciar': 'Faturamento: clientes faturados, contas a receber, faturas/boletos e créditos',
  'cafe.gerenciar': 'Café da manhã: composição, lista do dia e sobras',
  'despesas.gerenciar': 'Despesas / contas a pagar: cadastrar e dar baixa',
  'despesas.aprovar': 'Despesas: aprovar as contas e boletos lançados pelo setor de compras (sem esta permissão, o que lança espera aprovação)',
  'gorjetas.gerenciar': 'Gorjetas: regra da casa, relatório e repasse',
  'caixa.relatorios': 'Relatórios de caixa, prévia e ver o esperado antes de fechar',
  'penhoras.baixar': 'Penhoras: dar baixa sem pagamento (objeto ficou com a casa)',
  'relatorios.ver': 'Aba Relatórios: vendas, usos e movimentação por forma de pagamento',
  'notas.gerenciar': 'Relatórios de notas fiscais e desfazer emissão',
  'categorias.gerenciar': 'Cadastrar e editar categorias',
  'ambientes.gerenciar': 'Cadastrar e editar ambientes',
  'motivos.gerenciar': 'Cadastrar motivos de bloqueio',
  'perfis.gerenciar': 'Cadastrar perfis e limites',
  'usuarios.gerenciar': 'Cadastrar usuários',
  'funcionarios.gerenciar': 'Funcionários: cadastro, crachá e itens da revisão',
  'funcionarios.financeiro': 'Ficha financeira dos funcionários (vales, descontos, pagamentos e gorjetas)',
  'empresa.editar': 'Editar dados da empresa',
  'vistorias.fazer': 'Vistoriadoras: fazer a vistoria das suítes e quartos (fotos, checklist, frigobar)',
  'vistorias.decidir': 'Vistorias: decidir as reprovadas (limpeza ou manutenção) e dar ciência das ressalvas',
  'vistorias.configurar': 'Vistorias: cadastros (checklist, fotos obrigatórias, piscinas e hidros)',
  'vistorias.relatorio': 'Vistorias: histórico e baixar a planilha com as fotos',
  'piscinas.registrar': 'Piscinas e hidros: registrar medição, limpeza e produtos usados',
} as const;

export type Permissao = keyof typeof PERMISSOES;

/** Agrupamento por módulo, para montar perfis marcando o módulo inteiro. */
export const GRUPOS_PERMISSAO: { grupo: string; permissoes: Permissao[] }[] = [
  { grupo: 'Recepção e painel', permissoes: ['painel.ver', 'cozinha.ver', 'unidades.status', 'unidades.bloquear', 'unidades.desbloquear', 'reservas.gerenciar'] },
  { grupo: 'Contas (telefonista)', permissoes: ['estadias.operar', 'estadias.cancelar', 'estadias.corrigir', 'estadias.estornar', 'pagamentos.corrigir', 'cortesias.gerenciar'] },
  { grupo: 'Portaria e saída', permissoes: ['estadias.entrada', 'saida.registrar'] },
  { grupo: 'Governança (limpeza)', permissoes: ['governanca.operar', 'enxoval.gerenciar', 'enxoval.aprovar', 'cafe.gerenciar'] },
  { grupo: 'Tarifas e produtos', permissoes: ['tarifas.gerenciar', 'produtos.gerenciar', 'estoque.gerenciar', 'compras.gerenciar'] },
  { grupo: 'Caixa principal', permissoes: ['caixa.principal', 'caixa.sangria'] },
  { grupo: 'Caixa ADM e relatórios', permissoes: ['caixa.adm', 'caixa.relatorios', 'gorjetas.gerenciar', 'penhoras.baixar', 'relatorios.ver', 'despesas.gerenciar', 'despesas.aprovar', 'faturamento.gerenciar'] },
  { grupo: 'Notas fiscais', permissoes: ['notas.gerenciar'] },
  { grupo: 'Satisfação', permissoes: ['avaliacoes.ver'] },
  { grupo: 'Cadastros', permissoes: ['unidades.gerenciar', 'categorias.gerenciar', 'ambientes.gerenciar', 'motivos.gerenciar'] },
  { grupo: 'Vistoriadoras / Revisões', permissoes: ['vistorias.fazer', 'vistorias.decidir', 'vistorias.configurar', 'vistorias.relatorio', 'piscinas.registrar'] },
  { grupo: 'Equipe e empresa', permissoes: ['usuarios.gerenciar', 'perfis.gerenciar', 'empresa.editar', 'funcionarios.gerenciar', 'funcionarios.financeiro'] },
];

/**
 * Limites de cada perfil. Acima do limite, a ação pede a senha
 * de alguém cujo perfil permita (regra aplicada nos módulos de conta e caixa).
 */
export interface LimitesPerfil {
  /** Desconto máximo em % sobre a conta (0 a 100). */
  descontoPercentual?: number;
  /** Acréscimo máximo em %. */
  acrescimoPercentual?: number;
  /** Pode dar cortesia (venda com 100% de desconto). */
  cortesia?: boolean;
  /** Pode ajustar diária por número de pessoas (3ª pessoa etc.). */
  ajusteDiaria?: boolean;
}

export const STATUS_UNIDADE = [
  'livre',
  'ocupada',
  'conta_entregue',
  'paga',
  'limpeza',
  'vistoria',
  'bloqueada',
  'reservada',
] as const;
export type StatusUnidade = (typeof STATUS_UNIDADE)[number];

export const TIPOS_UNIDADE = ['suite', 'quarto', 'mesa', 'area'] as const;
export type TipoUnidade = (typeof TIPOS_UNIDADE)[number];

export const TIPOS_AMBIENTE = ['motel', 'hotel', 'pousada', 'restaurante', 'bar'] as const;
export type TipoAmbiente = (typeof TIPOS_AMBIENTE)[number];

/** Dados do usuário logado, gravados no token. */
export interface UsuarioToken {
  sub: string;
  empresaId: string;
  perfilId: string;
  nome: string;
  permissoes: string[];
  ambientesIds: string[] | null;
}

export function temPermissao(usuario: UsuarioToken, permissao: string): boolean {
  return usuario.permissoes.includes('*') || usuario.permissoes.includes(permissao);
}
