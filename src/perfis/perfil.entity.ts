import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { LimitesPerfil } from '../common/permissoes';

@Entity('perfis')
export class Perfil {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ length: 60 }) nome!: string;
  @Column({ type: 'text', nullable: true }) descricao!: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) permissoes!: string[];
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) limites!: LimitesPerfil;
  /** Perfil criado pelo sistema (Administrador): não pode ser excluído. */
  @Column({ default: false }) sistema!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
