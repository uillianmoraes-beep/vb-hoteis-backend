import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('avaliacoes')
export class Avaliacao {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'estadia_id', type: 'uuid' }) estadiaId!: string;
  @Column({ name: 'unidade_id', type: 'uuid', nullable: true }) unidadeId!: string | null;
  @Column({ name: 'ambiente_id', type: 'uuid', nullable: true }) ambienteId!: string | null;
  @Column({ type: 'smallint', nullable: true }) limpeza!: number | null;
  @Column({ type: 'smallint', nullable: true }) atendimento!: number | null;
  @Column({ type: 'smallint', nullable: true }) conforto!: number | null;
  @Column({ type: 'smallint', nullable: true }) consumo!: number | null;
  @Column({ type: 'numeric', precision: 3, scale: 2 }) geral!: string;
  @Column({ type: 'boolean', nullable: true }) voltaria!: boolean | null;
  @Column({ type: 'text', nullable: true }) comentario!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
