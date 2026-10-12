import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type StatusEstadia = 'aberta' | 'conta_entregue' | 'fechada' | 'cancelada';
export const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'debito', 'credito', 'faturado', 'penhora', 'cortesia', 'misto'] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

@Entity('estadias')
export class Estadia {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'ambiente_id', type: 'uuid' }) ambienteId!: string;
  @Column({ name: 'unidade_id', type: 'uuid' }) unidadeId!: string;
  @Column({ name: 'categoria_id', type: 'uuid', nullable: true }) categoriaId!: string | null;
  @Column({ name: 'tabela_id', type: 'uuid', nullable: true }) tabelaId!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'periodo' }) modalidade!: 'periodo' | 'pernoite';
  @Column({ type: 'varchar', length: 10, nullable: true }) placa!: string | null;
  @Column({ type: 'int', default: 2 }) pessoas!: number;
  @Column({ type: 'text', nullable: true }) observacao!: string | null;
  @Column({ type: 'varchar', length: 16, default: 'aberta' }) status!: StatusEstadia;
  @Column({ name: 'entrada_em', type: 'timestamptz' }) entradaEm!: Date;
  @Column({ name: 'conta_entregue_em', type: 'timestamptz', nullable: true }) contaEntregueEm!: Date | null;
  /** Minutos em que o tempo ficou parado (conta entregue e depois voltou a contar). */
  @Column({ name: 'pausado_min', type: 'int', default: 0 }) pausadoMin!: number;
  /** Pacote: cobra no mínimo este período. */
  @Column({ name: 'periodo_minimo_id', type: 'uuid', nullable: true }) periodoMinimoId!: string | null;
  @Column({ name: 'valor_consumo', type: 'numeric', precision: 10, scale: 2, nullable: true }) valorConsumo!: string | null;
  @Column({ name: 'saida_em', type: 'timestamptz', nullable: true }) saidaEm!: Date | null;
  @Column({ name: 'periodo_nome', type: 'varchar', length: 60, nullable: true }) periodoNome!: string | null;
  @Column({ name: 'valor_hospedagem', type: 'numeric', precision: 10, scale: 2, nullable: true }) valorHospedagem!: string | null;
  @Column({ name: 'valor_pessoas', type: 'numeric', precision: 10, scale: 2, nullable: true }) valorPessoas!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) desconto!: string;
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) acrescimo!: string;
  @Column({ name: 'valor_total', type: 'numeric', precision: 10, scale: 2, nullable: true }) valorTotal!: string | null;
  @Column({ name: 'forma_pagamento', type: 'varchar', length: 20, nullable: true }) formaPagamento!: FormaPagamento | null;
  /** Em dinheiro: quanto o cliente entregou. */
  @Column({ name: 'valor_recebido', type: 'numeric', precision: 10, scale: 2, nullable: true }) valorRecebido!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) troco!: string;
  /** cliente = troco devolvido; gorjeta = cliente deixou o troco */
  @Column({ name: 'troco_destino', type: 'varchar', length: 10, nullable: true }) trocoDestino!: 'cliente' | 'gorjeta' | null;
  @Column({ name: 'gorjeta_para', type: 'varchar', length: 120, nullable: true }) gorjetaPara!: string | null;
  @Column({ name: 'motivo_ajuste', type: 'text', nullable: true }) motivoAjuste!: string | null;
  @Column({ name: 'autorizado_por', type: 'varchar', length: 120, nullable: true }) autorizadoPor!: string | null;
  @Column({ name: 'usuario_entrada_id', type: 'uuid', nullable: true }) usuarioEntradaId!: string | null;
  @Column({ name: 'usuario_entrada_nome', type: 'varchar', length: 120, nullable: true }) usuarioEntradaNome!: string | null;
  @Column({ name: 'usuario_saida_id', type: 'uuid', nullable: true }) usuarioSaidaId!: string | null;
  @Column({ name: 'usuario_saida_nome', type: 'varchar', length: 120, nullable: true }) usuarioSaidaNome!: string | null;
  /** nao | pendente | emitida | erro | cancelada */
  @Column({ name: 'nota_status', type: 'varchar', length: 12, default: 'nao' }) notaStatus!: string;
  @Column({ name: 'nota_documento', type: 'varchar', length: 14, nullable: true }) notaDocumento!: string | null;
  @Column({ name: 'nota_nome', type: 'varchar', length: 120, nullable: true }) notaNome!: string | null;
  @Column({ name: 'nota_email', type: 'varchar', length: 160, nullable: true }) notaEmail!: string | null;
  @Column({ name: 'nota_solicitada_em', type: 'timestamptz', nullable: true }) notaSolicitadaEm!: Date | null;
  /** saída no portão (ticket de liberação conferido) */
  @Column({ name: 'saida_portaria_em', type: 'timestamptz', nullable: true }) saidaPortariaEm!: Date | null;
  @Column({ name: 'saida_portaria_por', type: 'varchar', length: 120, nullable: true }) saidaPortariaPor!: string | null;
  /** paga | pendente (saiu com a conta entregue, ainda sem fechar) */
  @Column({ name: 'saida_portaria_situacao', type: 'varchar', length: 12, nullable: true }) saidaPortariaSituacao!: string | null;
  /** número do uso / comanda (sequência da empresa) */
  @Column({ type: 'int', nullable: true }) numero!: number | null;
  /** código do QR de satisfação impresso na conta */
  @Column({ name: 'avaliacao_token', type: 'varchar', length: 16, nullable: true }) avaliacaoToken!: string | null;
  @Column({ name: 'nota_numero', type: 'varchar', length: 30, nullable: true }) notaNumero!: string | null;
  @Column({ name: 'nota_emitida_em', type: 'timestamptz', nullable: true }) notaEmitidaEm!: Date | null;
  @Column({ name: 'nota_emitida_por', type: 'varchar', length: 120, nullable: true }) notaEmitidaPor!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
