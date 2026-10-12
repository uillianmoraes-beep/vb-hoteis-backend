import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('estadia_itens')
export class EstadiaItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'estadia_id', type: 'uuid' }) estadiaId!: string;
  @Column({ name: 'produto_id', type: 'uuid', nullable: true }) produtoId!: string | null;
  @Column({ length: 120 }) descricao!: string;
  @Column({ type: 'numeric', precision: 10, scale: 3, default: 1 }) quantidade!: string;
  @Column({ name: 'preco_unitario', type: 'numeric', precision: 10, scale: 2 }) precoUnitario!: string;
  @Column({ type: 'numeric', precision: 10, scale: 2 }) total!: string;
  @Column({ type: 'varchar', length: 10, default: 'ativo' }) status!: 'ativo' | 'estornado';
  @Column({ name: 'motivo_estorno', type: 'text', nullable: true }) motivoEstorno!: string | null;
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true }) usuarioId!: string | null;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @Column({ name: 'estornado_por', type: 'varchar', length: 120, nullable: true }) estornadoPor!: string | null;
  @Column({ name: 'estornado_em', type: 'timestamptz', nullable: true }) estornadoEm!: Date | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
