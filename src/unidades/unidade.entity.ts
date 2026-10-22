import {
  Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { StatusUnidade, TipoUnidade } from '../common/permissoes';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { MotivoBloqueio } from '../motivos-bloqueio/motivo-bloqueio.entity';

/** Unidade universal: suíte, quarto, mesa ou área. */
@Entity('unidades')
export class Unidade {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;

  /** Ambiente em que a unidade está agora (pode mudar na virada de andar). */
  @Column({ name: 'ambiente_id', type: 'uuid' }) ambienteId!: string;
  @ManyToOne(() => Ambiente) @JoinColumn({ name: 'ambiente_id' }) ambiente?: Ambiente;

  /** Ambiente de origem, para onde volta no fim da virada. */
  @Column({ name: 'ambiente_padrao_id', type: 'uuid' }) ambientePadraoId!: string;

  @Column({ name: 'categoria_id', type: 'uuid', nullable: true }) categoriaId!: string | null;

  /** emprestada a outro ambiente: a categoria de origem fica guardada para a volta */
  @Column({ name: 'categoria_padrao_id', type: 'uuid', nullable: true }) categoriaPadraoId!: string | null;
  @Column({ name: 'emprestada_em', type: 'timestamptz', nullable: true }) emprestadaEm!: Date | null;
  /** emprestada pelo empréstimo automático (volta sozinha no fim da janela) */
  @Column({ name: 'emprestimo_auto', type: 'boolean', default: false }) emprestimoAuto!: boolean;
  @ManyToOne(() => Categoria, { nullable: true }) @JoinColumn({ name: 'categoria_id' }) categoria?: Categoria | null;

  @Column({ length: 20 }) codigo!: string;
  @Column({ type: 'varchar', length: 80, nullable: true }) nome!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'suite' }) tipo!: TipoUnidade;
  @Column({ type: 'varchar', length: 20, nullable: true }) andar!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) garagem!: string | null;
  @Column({ type: 'int', default: 2 }) capacidade!: number;
  /** cama de quarto coletivo: código do quarto (ex.: C01). Cada cama é uma unidade. */
  @Column({ type: 'varchar', length: 20, nullable: true }) coletivo!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'livre' }) status!: StatusUnidade;
  @Column({ name: 'status_desde', type: 'timestamptz', default: () => 'now()' }) statusDesde!: Date;
  /** +10 min para a camareira: vale só enquanto tempoExtraDesde = statusDesde (a situação não mudou) */
  @Column({ name: 'tempo_extra_min', type: 'int', default: 0 }) tempoExtraMin!: number;
  @Column({ name: 'tempo_extra_desde', type: 'timestamptz', nullable: true }) tempoExtraDesde!: Date | null;
  @Column({ name: 'motivo_bloqueio_id', type: 'uuid', nullable: true }) motivoBloqueioId!: string | null;
  @ManyToOne(() => MotivoBloqueio, { nullable: true }) @JoinColumn({ name: 'motivo_bloqueio_id' })
  motivoBloqueio?: MotivoBloqueio | null;
  @Column({ name: 'observacao_status', type: 'text', nullable: true }) observacaoStatus!: string | null;

  /** última vistoria (selo no Painel) e a validade mais próxima do frigobar */
  @Column({ name: 'vistoria_resultado', type: 'varchar', length: 10, nullable: true }) vistoriaResultado!: 'aprovado' | 'ressalva' | 'reprovado' | null;
  @Column({ name: 'vistoria_em', type: 'timestamptz', nullable: true }) vistoriaEm!: Date | null;
  @Column({ name: 'frigobar_validade', type: 'date', nullable: true }) frigobarValidade!: string | null;
  @Column({ type: 'int', default: 0 }) ordem!: number;
  @Column({ name: 'planta_x', type: 'numeric', precision: 8, scale: 2, nullable: true }) plantaX!: string | null;
  @Column({ name: 'planta_y', type: 'numeric', precision: 8, scale: 2, nullable: true }) plantaY!: string | null;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
