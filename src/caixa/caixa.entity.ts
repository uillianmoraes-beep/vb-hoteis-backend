import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Valores = Record<string, number>;

@Entity('caixa_turnos')
export class CaixaTurno {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'ambiente_id', type: 'uuid' }) ambienteId!: string;
  @Column({ type: 'int' }) numero!: number;
  @Column({ type: 'varchar', length: 10, default: 'aberto' }) status!: 'aberto' | 'fechado';
  @Column({ name: 'troco_inicial', type: 'numeric', precision: 10, scale: 2, default: 0 }) trocoInicial!: string;
  @Column({ name: 'aberto_por_id', type: 'uuid', nullable: true }) abertoPorId!: string | null;
  @Column({ name: 'aberto_por', type: 'varchar', length: 120, nullable: true }) abertoPor!: string | null;
  @Column({ name: 'aberto_em', type: 'timestamptz' }) abertoEm!: Date;
  @Column({ name: 'fechado_por_id', type: 'uuid', nullable: true }) fechadoPorId!: string | null;
  @Column({ name: 'fechado_por', type: 'varchar', length: 120, nullable: true }) fechadoPor!: string | null;
  @Column({ name: 'fechado_em', type: 'timestamptz', nullable: true }) fechadoEm!: Date | null;
  @Column({ type: 'jsonb', nullable: true }) esperado!: Valores | null;
  @Column({ type: 'jsonb', nullable: true }) contado!: Valores | null;
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true }) diferenca!: string | null;
  @Column({ type: 'text', nullable: true }) observacao!: string | null;
  /** dinheiro que ficou na gaveta para o próximo turno */
  @Column({ name: 'fundo_proximo', type: 'numeric', precision: 10, scale: 2, nullable: true }) fundoProximo!: string | null;
  /** dinheiro retirado/entregue à gerência no fechamento (vai para o caixa ADM) */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true }) retirado!: string | null;
}

@Entity('caixa_movimentos')
export class CaixaMovimento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'turno_id', type: 'uuid', nullable: true }) turnoId!: string | null;
  @Column({ type: 'varchar', length: 10 }) caixa!: 'principal' | 'adm';
  /** principal: sangria | reforco | despesa · adm: entrada | saida | sangria (recebida) */
  @Column({ type: 'varchar', length: 15 }) tipo!: string;
  @Column({ type: 'varchar', length: 20, default: 'dinheiro' }) forma!: string;
  @Column({ type: 'numeric', precision: 10, scale: 2 }) valor!: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) descricao!: string | null;
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true }) usuarioId!: string | null;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @Column({ name: 'autorizado_por', type: 'varchar', length: 120, nullable: true }) autorizadoPor!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
