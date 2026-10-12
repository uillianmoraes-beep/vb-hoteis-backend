/**
 * Módulos vendidos à parte (revenda). O núcleo (painel, contas, tarifas,
 * cadastros) vem sempre; estes só aparecem e funcionam quando liberados na
 * licença da empresa — quem libera é a Virtual Barra, não o cliente.
 */
export const MODULOS = {
  notas: 'Notas fiscais (relatórios de emissão e tributação)',
  caixa: 'Caixa (turnos, sangria, fechamento)',
  estoque: 'Estoque',
  hotel: 'Hotel / pousada (reservas e cadastro de hóspedes)',
  restaurante: 'Restaurante / bar (mesas e comandas)',
  manutencao: 'Integração VB Manutenção',
} as const;

export type Modulo = keyof typeof MODULOS;

export function moduloAtivo(modulos: Record<string, boolean> | null | undefined, m: Modulo): boolean {
  return !!modulos?.[m];
}
