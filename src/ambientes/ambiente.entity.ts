import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TipoAmbiente } from '../common/permissoes';

export interface RegrasAmbiente {
  toleranciaMin?: number;
  aposUltimo?: 'hora_adicional' | 'pernoite';
  pessoasIncluidas?: number;
  alertaViradaMin?: number;
}

@Entity('ambientes')
export class Ambiente {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'empresa_id', type: 'uuid' }) empresaId!: string;
  @Column({ length: 80 }) nome!: string;
  @Column({ type: 'varchar', length: 20 }) tipo!: TipoAmbiente;
  @Column({ type: 'varchar', length: 9, nullable: true }) cor!: string | null;
  @Column({ type: 'int', default: 0 }) ordem!: number;
  /** Regras de cobrança do ambiente: tolerância, o que acontece depois do último período etc. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) regras!: RegrasAmbiente;
  /** entrada e saída pelo mesmo portão (saída registrada no painel da portaria) */
  @Column({ name: 'portao_unico', default: false }) portaoUnico!: boolean;
  /** a suíte paga só vai para limpeza quando o portão confere o ticket */
  @Column({ name: 'limpeza_na_saida', default: false }) limpezaNaSaida!: boolean;
  @Column({ default: true }) ativo!: boolean;
  @CreateDateColumn({ name: 'criado_em', type: 'timestamptz' }) criadoEm!: Date;
  @UpdateDateColumn({ name: 'atualizado_em', type: 'timestamptz' }) atualizadoEm!: Date;
}
