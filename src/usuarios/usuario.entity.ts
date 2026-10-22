import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { Perfil } from '../perfis/perfil.entity';

@Entity('usuarios')
export class UsuarioEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'perfil_id', type: 'uuid' }) perfilId!: string;
  @ManyToOne(() => Perfil) @JoinColumn({ name: 'perfil_id' }) perfil?: Perfil;
  @Column({ length: 120 }) nome!: string;
  @Column({ length: 120 }) login!: string;
  @Column({ name: 'senha_hash', length: 100, select: false }) senhaHash!: string;
  /** Ambientes que o usuário pode ver. Vazio/nulo = todos. */
  @Column({ name: 'ambientes_ids', type: 'uuid', array: true, nullable: true }) ambientesIds!: string[] | null;
  /** aparece na lista de quem recebe gorjeta (garçom, camareira…) */
  @Column({ name: 'recebe_gorjeta', default: false }) recebeGorjeta!: boolean;
  /** pode entrar pelo celular/tablet */
  @Column({ name: 'acesso_celular', default: true }) acessoCelular!: boolean;
  @Column({ default: true }) ativo!: boolean;
  /** muitas senhas erradas: bloqueado até esta hora */
  @Column({ name: 'bloqueado_ate', type: 'timestamptz', nullable: true }) bloqueadoAte!: Date | null;
  @Column({ name: 'ultimo_acesso', type: 'timestamptz', nullable: true }) ultimoAcesso!: Date | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
