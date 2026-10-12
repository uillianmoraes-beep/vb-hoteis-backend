import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('motivos_bloqueio')
export class MotivoBloqueio {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ length: 80 }) nome!: string;
  @Column({ type: 'varchar', length: 9, nullable: true }) cor!: string | null;
  /** Quando true, bloquear com este motivo abre OS no VB Manutenção (integração em lote futuro). */
  @Column({ name: 'abre_manutencao', default: false }) abreManutencao!: boolean;
  @Column({ type: 'int', default: 0 }) ordem!: number;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
