import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Linha do tempo da comanda: entrada, consumo, transferência, troca de cobrança, correções, pagamento. */
@Entity('estadia_eventos')
export class EstadiaEvento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'estadia_id', type: 'uuid' }) estadiaId!: string;
  @Column({ type: 'varchar', length: 30 }) tipo!: string;
  @Column({ type: 'text' }) descricao!: string;
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true }) usuarioId!: string | null;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
