import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('gorjetas')
export class Gorjeta {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'estadia_id', type: 'uuid', nullable: true }) estadiaId!: string | null;
  @Column({ name: 'turno_id', type: 'uuid', nullable: true }) turnoId!: string | null;
  /** troco deixado em dinheiro | valor a mais no cartão/pix */
  @Column({ type: 'varchar', length: 10 }) origem!: 'troco' | 'adicional';
  @Column({ type: 'varchar', length: 20 }) forma!: string;
  @Column({ type: 'numeric', precision: 10, scale: 2 }) valor!: string;
  @Column({ name: 'taxa_pct', type: 'numeric', precision: 5, scale: 2, default: 0 }) taxaPct!: string;
  @Column({ name: 'valor_liquido', type: 'numeric', precision: 10, scale: 2 }) valorLiquido!: string;
  @Column({ name: 'beneficiario_id', type: 'uuid', nullable: true }) beneficiarioId!: string | null;
  @Column({ name: 'beneficiario_nome', type: 'varchar', length: 120 }) beneficiarioNome!: string;
  @Column({ type: 'varchar', length: 12 }) status!: 'paga_na_hora' | 'a_repassar' | 'repassada' | 'casa';
  @Column({ name: 'repassada_em', type: 'timestamptz', nullable: true }) repassadaEm!: Date | null;
  @Column({ name: 'repassada_por', type: 'varchar', length: 120, nullable: true }) repassadaPor!: string | null;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
