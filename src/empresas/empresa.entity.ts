import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('empresas')
export class Empresa {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ length: 150 }) nome!: string;
  @Column({ type: 'varchar', length: 18, nullable: true }) cnpj!: string | null;
  /** Termos renomeados pelo estabelecimento, ex.: { "suite": "cabine", "recepcao": "telefonista" } */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) vocabulario!: Record<string, string>;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
