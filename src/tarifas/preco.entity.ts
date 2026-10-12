import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type TipoPreco = 'periodo' | 'hora_adicional' | 'pessoa_adicional';

@Entity('precos')
export class Preco {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tabela_id', type: 'uuid' }) tabelaId!: string;
  @Column({ name: 'categoria_id', type: 'uuid' }) categoriaId!: string;
  @Column({ type: 'varchar', length: 20 }) tipo!: TipoPreco;
  @Column({ name: 'periodo_id', type: 'uuid', nullable: true }) periodoId!: string | null;
  /** numeric volta como texto: "120.00" */
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) valor!: string;
  /** Nesta tabela, o período dura outro tempo (ex.: 4 horas vira 3 horas numa data especial). */
  @Column({ name: 'duracao_min', type: 'int', nullable: true }) duracaoMin!: number | null;
}
