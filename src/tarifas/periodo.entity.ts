import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('periodos')
export class Periodo {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'ambiente_id', type: 'uuid' }) ambienteId!: string;
  @Column({ length: 40 }) nome!: string;
  @Column({ type: 'varchar', length: 10 }) tipo!: 'horas' | 'pernoite';
  @Column({ name: 'duracao_min', type: 'int', nullable: true }) duracaoMin!: number | null;
  @Column({ name: 'pernoite_inicio', type: 'varchar', length: 5, nullable: true }) pernoiteInicio!: string | null;
  @Column({ name: 'pernoite_fim', type: 'varchar', length: 5, nullable: true }) pernoiteFim!: string | null;
  /** Categorias em que o período vale. Vazio/nulo = todas. */
  @Column({ name: 'categoria_ids', type: 'uuid', array: true, nullable: true }) categoriaIds!: string[] | null;
  @Column({ type: 'int', default: 0 }) ordem!: number;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
