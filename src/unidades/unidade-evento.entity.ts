import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Cada mudança de status fica registrada: quem, quando, de onde para onde e por quê. */
@Entity('unidade_eventos')
export class UnidadeEvento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'unidade_id', type: 'uuid' }) unidadeId!: string;
  @Column({ name: 'status_anterior', type: 'varchar', length: 20, nullable: true }) statusAnterior!: string | null;
  @Column({ name: 'status_novo', type: 'varchar', length: 20 }) statusNovo!: string;
  @Column({ name: 'motivo_bloqueio_id', type: 'uuid', nullable: true }) motivoBloqueioId!: string | null;
  @Column({ type: 'text', nullable: true }) observacao!: string | null;
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true }) usuarioId!: string | null;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
