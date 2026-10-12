import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { DadosFiscais, DocumentoFiscal } from '../common/fiscal';

@Entity('regras_fiscais')
export class RegraFiscal {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ type: 'varchar', length: 10 }) documento!: DocumentoFiscal;
  /** vazio = regra padrão do documento */
  @Column({ type: 'varchar', length: 4, nullable: true }) cfop!: string | null;
  @Column({ length: 120 }) nome!: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) dados!: DadosFiscais;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
