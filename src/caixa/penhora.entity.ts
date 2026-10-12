import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Objeto deixado pelo cliente como garantia do que ficou devendo. */
@Entity('penhoras')
export class Penhora {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'ambiente_id', type: 'uuid' }) ambienteId!: string;
  @Column({ name: 'estadia_id', type: 'uuid', nullable: true }) estadiaId!: string | null;
  @Column({ name: 'pagamento_id', type: 'uuid', nullable: true }) pagamentoId!: string | null;
  @Column({ name: 'turno_id', type: 'uuid', nullable: true }) turnoId!: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 2 }) valor!: string;
  @Column({ type: 'varchar', length: 200 }) item!: string;
  @Column({ type: 'varchar', length: 120, nullable: true }) contato!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'aberta' }) status!: 'aberta' | 'resgatada' | 'baixada';
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @Column({ name: 'resolvida_em', type: 'timestamptz', nullable: true }) resolvidaEm!: Date | null;
  @Column({ name: 'resolvida_por', type: 'varchar', length: 120, nullable: true }) resolvidaPor!: string | null;
  @Column({ name: 'forma_resgate', type: 'varchar', length: 20, nullable: true }) formaResgate!: string | null;
  @Column({ name: 'turno_resgate_id', type: 'uuid', nullable: true }) turnoResgateId!: string | null;
  @Column({ name: 'motivo_baixa', type: 'varchar', length: 300, nullable: true }) motivoBaixa!: string | null;
}
