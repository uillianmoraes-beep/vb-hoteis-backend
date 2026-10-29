/**
 * Módulos vendidos à parte (revenda). O núcleo (painel, contas, tarifas,
 * cadastros) vem sempre; estes só aparecem e funcionam quando liberados na
 * licença da empresa — quem libera é a Virtual Barra, não o cliente.
 */
export const MODULOS = {
  notas: 'Notas fiscais (relatórios de emissão e tributação)',
  nfce: 'NFC-e (cupom fiscal do consumo)',
  nfse: 'NFS-e (nota de serviço / hospedagem)',
  nfe: 'NF-e (nota completa e devolução)',
  caixa: 'Caixa (turnos, sangria, fechamento)',
  estoque: 'Estoque',
  hotel: 'Hotel / pousada (reservas e cadastro de hóspedes)',
  restaurante: 'Restaurante / bar (mesas e comandas)',
  manutencao: 'Integração VB Manutenção',
  satisfacao: 'Pesquisa de satisfação (QR code na conta + relatório)',
} as const;

export type Modulo = keyof typeof MODULOS;

/** módulos fiscais vendidos à parte, cada um com o seu preço na mensalidade */
export const MODULOS_FISCAIS = ['nfce', 'nfse', 'nfe'] as const;
export type ModuloFiscal = (typeof MODULOS_FISCAIS)[number];

/** o módulo fiscal está liberado? (empresa antiga, sem a escolha separada, segue o módulo "Notas fiscais") */
export function fiscalLiberado(modulos: Record<string, boolean> | null | undefined, m: ModuloFiscal): boolean {
  const v = modulos?.[m];
  return v === undefined ? !!modulos?.notas : !!v;
}

export function moduloAtivo(modulos: Record<string, boolean> | null | undefined, m: Modulo): boolean {
  return !!modulos?.[m];
}
