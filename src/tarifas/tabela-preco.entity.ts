import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('tabelas_preco')
export class TabelaPreco {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'ambiente_id', type: 'uuid' }) ambienteId!: string;
  @Column({ length: 60 }) nome!: string;
  /** 0 = domingo … 6 = sábado */
  @Column({ name: 'dias_semana', type: 'int', array: true, default: () => "'{0,1,2,3,4,5,6}'" }) diasSemana!: number[];
  @Column({ name: 'hora_inicio', type: 'varchar', length: 5, nullable: true }) horaInicio!: string | null;
  @Column({ name: 'hora_fim', type: 'varchar', length: 5, nullable: true }) horaFim!: string | null;
  /** Data especial (ex.: Dia dos Namorados): "AAAA-MM-DD". Com datas, a tabela ganha das demais nesses dias. */
  @Column({ name: 'data_inicio', type: 'date', nullable: true }) dataInicio!: string | null;
  @Column({ name: 'data_fim', type: 'date', nullable: true }) dataFim!: string | null;
  /** Quando duas tabelas valem no mesmo horário, ganha a de prioridade maior. */
  @Column({ type: 'int', default: 0 }) prioridade!: number;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
