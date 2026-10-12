/**
 * Catálogo de permissões. O perfil Administrador recebe '*' (tudo).
 * Novas permissões entram aqui conforme os módulos forem chegando.
 */
export const PERMISSOES = {
  'painel.ver': 'Ver o Painel de Unidades',
  'unidades.status': 'Mudar status das unidades (limpeza, vistoria, livre)',
  'unidades.bloquear': 'Bloquear unidade com motivo',
  'unidades.desbloquear': 'Desbloquear unidade',
  'unidades.gerenciar': 'Cadastrar e editar unidades',
  'governanca.operar': 'Tela da governança (limpeza, vistoria, camareiras)',
  'estadias.operar': 'Dar entrada, entregar e fechar contas',
  'estadias.entrada': 'Dar entrada e receber na entrada (portaria)',
  'estadias.cancelar': 'Cancelar uma entrada já feita',
  'tarifas.gerenciar': 'Configurar períodos, preços e regras de cobrança',
  'estadias.corrigir': 'Corrigir hora de entrada e tabela de uma conta',
  'estadias.estornar': 'Estornar item lançado na conta',
  'produtos.gerenciar': 'Cadastrar produtos e serviços',
  'avaliacoes.ver': 'Ver o relatório de satisfação dos clientes',
  'notas.gerenciar': 'Relatórios de notas fiscais e desfazer emissão',
  'categorias.gerenciar': 'Cadastrar e editar categorias',
  'ambientes.gerenciar': 'Cadastrar e editar ambientes',
  'motivos.gerenciar': 'Cadastrar motivos de bloqueio',
  'perfis.gerenciar': 'Cadastrar perfis e limites',
  'usuarios.gerenciar': 'Cadastrar usuários',
  'empresa.editar': 'Editar dados da empresa',
} as const;

export type Permissao = keyof typeof PERMISSOES;

/** Agrupamento por módulo, para montar perfis marcando o módulo inteiro. */
export const GRUPOS_PERMISSAO: { grupo: string; permissoes: Permissao[] }[] = [
  { grupo: 'Recepção e painel', permissoes: ['painel.ver', 'unidades.status', 'unidades.bloquear', 'unidades.desbloquear'] },
  { grupo: 'Contas (telefonista)', permissoes: ['estadias.operar', 'estadias.cancelar', 'estadias.corrigir', 'estadias.estornar'] },
  { grupo: 'Portaria', permissoes: ['estadias.entrada'] },
  { grupo: 'Governança (limpeza)', permissoes: ['governanca.operar'] },
  { grupo: 'Tarifas e produtos', permissoes: ['tarifas.gerenciar', 'produtos.gerenciar'] },
  { grupo: 'Notas fiscais', permissoes: ['notas.gerenciar'] },
  { grupo: 'Satisfação', permissoes: ['avaliacoes.ver'] },
  { grupo: 'Cadastros', permissoes: ['unidades.gerenciar', 'categorias.gerenciar', 'ambientes.gerenciar', 'motivos.gerenciar'] },
  { grupo: 'Equipe e empresa', permissoes: ['usuarios.gerenciar', 'perfis.gerenciar', 'empresa.editar'] },
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
