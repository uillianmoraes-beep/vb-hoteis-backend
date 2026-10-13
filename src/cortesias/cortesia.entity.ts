import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('cortesias')
export class Cortesia {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ type: 'varchar', length: 80 }) nome!: string;
  @Column({ type: 'numeric', precision: 5, scale: 2 }) percentual!: string;
  /** total = conta inteira; hospedagem = só o período (consumo cobrado normal) */
  @Column({ name: 'aplica_em', type: 'varchar', length: 12, default: 'total' }) aplicaEm!: 'total' | 'hospedagem';
  /** vazio = todas as categorias */
  @Column({ name: 'categoria_ids', type: 'jsonb', default: () => "'[]'::jsonb" }) categoriaIds!: string[];
  /** vazio = todas as suítes */
  @Column({ name: 'unidade_ids', type: 'jsonb', default: () => "'[]'::jsonb" }) unidadeIds!: string[];
  @Column({ name: 'validade_ate', type: 'date', nullable: true }) validadeAte!: string | null;
  /** pede login e senha de quem gerencia cortesias */
  @Column({ name: 'exige_senha', default: false }) exigeSenha!: boolean;
  @Column({ type: 'varchar', length: 9, nullable: true }) cor!: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) descricao!: string | null;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
