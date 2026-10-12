import type { DadosFiscais } from '../common/fiscal';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('empresas')
export class Empresa {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ length: 150 }) nome!: string;
  @Column({ type: 'varchar', length: 18, nullable: true }) cnpj!: string | null;
  /** Termos renomeados pelo estabelecimento, ex.: { "suite": "cabine", "recepcao": "telefonista" } */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) vocabulario!: Record<string, string>;
  /** Tema e cores dos status escolhidos pela empresa, ex.: { "tema": "dia", "cores": { "livre": "#16A34A" } } */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) aparencia!: { tema?: string; cores?: Record<string, string> };
  /** tributação do serviço de hospedagem (NFS-e) */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) fiscal!: { hospedagem?: DadosFiscais };
  @Column({ name: 'ultimo_uso', type: 'int', default: 0 }) ultimoUso!: number;
  /** módulos contratados (revenda); só a Virtual Barra altera */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) modulos!: Record<string, boolean>;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
