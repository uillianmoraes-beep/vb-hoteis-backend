import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TipoUnidade } from '../common/permissoes';

@Entity('categorias')
export class Categoria {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  /** ambiente dono da categoria (motel, hotel…); vazio = ainda sem ambiente, aparece em todos */
  @Column({ name: 'ambiente_id', type: 'uuid', nullable: true }) ambienteId!: string | null;
  @Column({ length: 80 }) nome!: string;
  @Column({ type: 'text', nullable: true }) descricao!: string | null;
  @Column({ name: 'tipo_unidade', type: 'varchar', length: 20, default: 'suite' }) tipoUnidade!: TipoUnidade;
  @Column({ type: 'int', default: 0 }) ordem!: number;
  /** foto da categoria (data:image/jpeg;base64, reduzida no navegador) para as teclas com foto */
  @Column({ type: 'text', nullable: true }) foto!: string | null;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
