import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('estadia_pagamentos')
export class EstadiaPagamento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'estadia_id', type: 'uuid' }) estadiaId!: string;
  @Column({ type: 'varchar', length: 20 }) forma!: string;
  /** quanto este pagamento abate da conta */
  @Column({ type: 'numeric', precision: 10, scale: 2 }) valor!: string;
  @Column({ name: 'valor_recebido', type: 'numeric', precision: 10, scale: 2, nullable: true }) valorRecebido!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) troco!: string;
  @Column({ name: 'troco_destino', type: 'varchar', length: 10, nullable: true }) trocoDestino!: 'cliente' | 'gorjeta' | null;
  @Column({ name: 'gorjeta_para', type: 'varchar', length: 120, nullable: true }) gorjetaPara!: string | null;
  /** código do comprovante da maquininha (NSU / autorização) ou ID do Pix: base da conciliação bancária */
  @Column({ type: 'varchar', length: 60, nullable: true }) comprovante!: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) maquininha!: string | null;
  /** crédito parcelado */
  @Column({ type: 'smallint', nullable: true }) parcelas!: number | null;
  /** entrada (portaria) | adiantamento | fechamento */
  @Column({ type: 'varchar', length: 12, default: 'fechamento' }) momento!: string;
  /** turno do caixa em que o dinheiro entrou */
  @Column({ name: 'turno_id', type: 'uuid', nullable: true }) turnoId!: string | null;
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true }) usuarioId!: string | null;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
