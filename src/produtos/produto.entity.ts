import type { DadosFiscais } from '../common/fiscal';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('produtos')
export class Produto {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ length: 120 }) nome!: string;
  @Column({ type: 'varchar', length: 30, nullable: true }) codigo!: string | null;
  /** EAN/GTIN da embalagem (leitor ou câmera) */
  @Column({ name: 'codigo_barras', type: 'varchar', length: 20, nullable: true }) codigoBarras!: string | null;
  @Column({ type: 'varchar', length: 60, nullable: true }) grupo!: string | null;
  @Column({ type: 'varchar', length: 10, default: 'produto' }) tipo!: 'produto' | 'servico';
  /** venda (aparece nas telas de venda) ou interno (ingrediente, limpeza, higiene: só estoque) */
  @Column({ type: 'varchar', length: 10, default: 'venda' }) uso!: 'venda' | 'interno';
  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) preco!: string;
  /** custo digitado (vale enquanto não há custo pelas entradas do estoque) */
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true }) custo!: string | null;
  /** ficha técnica: quantas porções a receita rende */
  @Column({ name: 'ficha_rendimento', type: 'numeric', precision: 10, scale: 3, default: 1 }) fichaRendimento!: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) fiscal!: DadosFiscais;
  @Column({ default: false }) frigobar!: boolean;
  @Column({ name: 'controla_estoque', default: false }) controlaEstoque!: boolean;
  @Column({ name: 'estoque_minimo', type: 'numeric', precision: 12, scale: 3, default: 0 }) estoqueMinimo!: string;
  @Column({ type: 'varchar', length: 8, default: 'un' }) unidade!: string;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
