import type { DadosFiscais } from '../common/fiscal';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('produtos')
export class Produto {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ length: 120 }) nome!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) codigo!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) grupo!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'produto' }) tipo!: 'produto' | 'servico';
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) preco!: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) fiscal!: DadosFiscais;
  @Column({ default: false }) frigobar!: boolean;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
