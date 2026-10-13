import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const FUNCOES = ['camareira', 'governanta', 'recepcionista', 'portaria', 'garcom', 'cozinha', 'manutencao', 'gerente', 'outro'] as const;
export type Funcao = (typeof FUNCOES)[number];

@Entity('funcionarios')
export class Funcionario {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ type: 'int' }) matricula!: number;
  @Column({ type: 'varchar', length: 120 }) nome!: string;
  @Column({ type: 'varchar', length: 30, default: 'camareira' }) funcao!: Funcao;
  /** vazio = todos os ambientes (motel e hotel) */
  @Column({ name: 'ambiente_ids', type: 'jsonb', default: () => "'[]'::jsonb" }) ambienteIds!: string[];
  @Column({ type: 'varchar', length: 30, nullable: true }) telefone!: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) documento!: string | null;
  @Column({ name: 'chave_pix', type: 'varchar', length: 120, nullable: true }) chavePix!: string | null;
  @Column({ type: 'date', nullable: true }) admissao!: string | null;
  @Column({ type: 'text', nullable: true, select: false }) foto!: string | null;
  /** login no sistema, se tiver */
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true }) usuarioId!: string | null;
  @Column({ name: 'recebe_gorjeta', default: false }) recebeGorjeta!: boolean;
  @Column({ type: 'varchar', length: 300, nullable: true }) observacao!: string | null;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}

@Entity('funcionario_lancamentos')
export class FuncionarioLancamento {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'funcionario_id', type: 'uuid' }) funcionarioId!: string;
  /** vale/desconto = deve à casa; bônus = a receber; pagamento = a casa pagou */
  @Column({ type: 'varchar', length: 12 }) tipo!: 'vale' | 'desconto' | 'bonus' | 'pagamento';
  @Column({ type: 'numeric', precision: 10, scale: 2 }) valor!: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) descricao!: string | null;
  @Column({ type: 'date' }) data!: string;
  @Column({ name: 'usuario_nome', type: 'varchar', length: 120, nullable: true }) usuarioNome!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}

@Entity('revisoes')
export class Revisao {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ name: 'unidade_id', type: 'uuid' }) unidadeId!: string;
  @Column({ name: 'camareira_id', type: 'uuid', nullable: true }) camareiraId!: string | null;
  @Column({ name: 'camareira_nome', type: 'varchar', length: 120, nullable: true }) camareiraNome!: string | null;
  @Column({ name: 'revisor_nome', type: 'varchar', length: 120, nullable: true }) revisorNome!: string | null;
  /** [{ item, ok }] */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) itens!: { item: string; ok: boolean }[];
  @Column() aprovada!: boolean;
  @Column({ type: 'int', nullable: true }) nota!: number | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) observacao!: string | null;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
}
