import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UsuarioToken } from '../common/permissoes';
import { EmprestimoAutoDto } from './emprestimo.dto';

const FUSO = 'America/Sao_Paulo';
const SEMANA = 7 * 1440;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** configuração do empréstimo automático, guardada no ambiente de origem */
export interface EmprestimoAuto {
  ativo: boolean;
  destinoId: string | null;
  categoriaId: string | null;
  unidadeIds: string[];
  inicioDia: number;
  inicioHora: string;
  fimDia: number;
  fimHora: string;
  /** controle interno: início da janela em andamento e o que ainda falta emprestar nela */
  janela?: string | null;
  pendentes?: string[];
}

const PADRAO: EmprestimoAuto = { ativo: false, destinoId: null, categoriaId: null, unidadeIds: [], inicioDia: 5, inicioHora: '18:00', fimDia: 0, fimHora: '12:00' };

interface Quem { id: string | null; nome: string }
export interface Resultado { feitas: string[]; puladas: { codigo: string; motivo: string }[] }

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** minuto da semana agora, no fuso do Brasil (0 = domingo 00:00) */
export function minutoDaSemana(agora = new Date()): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(agora).map((x) => [x.type, x.value]));
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return dia * 1440 + (Number(p.hour) % 24) * 60 + Number(p.minute);
}

/** está dentro da janela? e quantos minutos já passaram do início / faltam para o fim */
export function situacaoJanela(c: Pick<EmprestimoAuto, 'inicioDia' | 'inicioHora' | 'fimDia' | 'fimHora'>, t: number) {
  const ini = c.inicioDia * 1440 + minutos(c.inicioHora);
  const fim = c.fimDia * 1440 + minutos(c.fimHora);
  const desdeInicio = (t - ini + SEMANA) % SEMANA;
  const duracao = (fim - ini + SEMANA) % SEMANA || SEMANA;
  const dentro = desdeInicio < duracao;
  return { dentro, desdeInicio, faltam: dentro ? duracao - desdeInicio : 0 };
}

const dataLocal = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: FUSO });

/**
 * Empréstimo de unidades entre ambientes (ex.: quartos do hotel para o motel no fim de semana).
 * Emprestada, a unidade aparece no Painel do destino e cobra pela categoria escolhida de lá;
 * a conta e o caixa são do destino. Não empresta nem devolve unidade com conta aberta, e não
 * empresta unidade com reserva no período.
 */
@Injectable()
export class EmprestimoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Emprestimo');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly ds: DataSource) {}

  private async destino(empresaId: string, ambienteId: string, categoriaId: string) {
    const [a] = await this.ds.query(`SELECT id, nome FROM ambientes WHERE id = $1 AND empresa_id = $2 AND ativo`, [ambienteId, empresaId]);
    if (!a) throw new BadRequestException('Escolha para qual ambiente emprestar.');
    const [c] = await this.ds.query(
      `SELECT id, nome FROM categorias WHERE id = $1 AND empresa_id = $2 AND ativo AND (ambiente_id = $3 OR ambiente_id IS NULL)`, [categoriaId, empresaId, ambienteId]);
    if (!c) throw new BadRequestException(`Escolha uma categoria do ${a.nome} (é por ela que o quarto vai cobrar).`);
    return { ambiente: a as { id: string; nome: string }, categoria: c as { id: string; nome: string } };
  }

  /** empresta as unidades; `ate` = último dia em que não pode haver reserva (padrão: amanhã) */
  async emprestar(empresaId: string, ids: string[], ambienteId: string, categoriaId: string, quem: Quem, auto = false, ate?: string): Promise<Resultado> {
    const { ambiente, categoria } = await this.destino(empresaId, ambienteId, categoriaId);
    const limite = ate ?? dataLocal(new Date(Date.now() + 86_400_000));
    const lista: { id: string; codigo: string; status: string; ambiente_id: string; ambiente_padrao_id: string; emprestada_em: Date | null }[] = await this.ds.query(
      `SELECT id, codigo, status, ambiente_id, ambiente_padrao_id, emprestada_em FROM unidades WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND ativo ORDER BY ordem, codigo`,
      [empresaId, ids]);
    const r: Resultado = { feitas: [], puladas: [] };
    for (const un of lista) {
      const pular = (motivo: string) => r.puladas.push({ codigo: un.codigo, motivo });
      if (un.emprestada_em || un.ambiente_id !== un.ambiente_padrao_id) { pular('já está emprestada'); continue; }
      if (un.ambiente_padrao_id === ambiente.id) { pular(`já é do ${ambiente.nome}`); continue; }
      const [conta] = await this.ds.query(`SELECT 1 FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue') LIMIT 1`, [un.id]);
      if (conta || ['ocupada', 'conta_entregue', 'paga'].includes(un.status)) { pular('está ocupada'); continue; }
      const [reserva] = await this.ds.query(
        `SELECT 1 FROM reservas WHERE unidade_id = $1 AND status IN ('pendente','confirmada') AND chegada <= $2::date AND saida > $3::date LIMIT 1`,
        [un.id, limite, dataLocal(new Date())]);
      if (reserva || un.status === 'reservada') { pular('tem reserva'); continue; }
      await this.ds.transaction(async (m) => {
        await m.query(
          `UPDATE unidades SET ambiente_id = $2, categoria_padrao_id = categoria_id, categoria_id = $3, emprestada_em = now(), emprestimo_auto = $4 WHERE id = $1`,
          [un.id, ambiente.id, categoria.id, auto]);
        await m.query(
          `INSERT INTO unidade_eventos (empresa_id, unidade_id, status_anterior, status_novo, observacao, usuario_id, usuario_nome) VALUES ($1,$2,$3::varchar,$3::varchar,$4,$5,$6)`,
          [empresaId, un.id, un.status, `Emprestada ao ${ambiente.nome} (cobra como ${categoria.nome})${auto ? ' · automático' : ''}`, quem.id, quem.nome]);
      });
      r.feitas.push(un.codigo);
    }
    return r;
  }

  /** devolve ao ambiente de origem, com a categoria de antes */
  async devolver(empresaId: string, ids: string[], quem: Quem, soAuto = false): Promise<Resultado> {
    const lista: { id: string; codigo: string; status: string; emprestada_em: Date | null; emprestimo_auto: boolean; origem: string }[] = await this.ds.query(
      `SELECT un.id, un.codigo, un.status, un.emprestada_em, un.emprestimo_auto, a.nome AS origem
         FROM unidades un JOIN ambientes a ON a.id = un.ambiente_padrao_id
        WHERE un.empresa_id = $1 AND un.id = ANY($2::uuid[]) ORDER BY un.ordem, un.codigo`, [empresaId, ids]);
    const r: Resultado = { feitas: [], puladas: [] };
    for (const un of lista) {
      if (!un.emprestada_em || (soAuto && !un.emprestimo_auto)) { if (!soAuto) r.puladas.push({ codigo: un.codigo, motivo: 'não está emprestada' }); continue; }
      const [conta] = await this.ds.query(`SELECT 1 FROM estadias WHERE unidade_id = $1 AND status IN ('aberta','conta_entregue') LIMIT 1`, [un.id]);
      if (conta || ['ocupada', 'conta_entregue', 'paga'].includes(un.status)) { r.puladas.push({ codigo: un.codigo, motivo: 'está com cliente (volta quando a conta fechar)' }); continue; }
      await this.ds.transaction(async (m) => {
        await m.query(
          `UPDATE unidades SET ambiente_id = ambiente_padrao_id, categoria_id = COALESCE(categoria_padrao_id, categoria_id), categoria_padrao_id = NULL,
             emprestada_em = NULL, emprestimo_auto = false WHERE id = $1`, [un.id]);
        await m.query(
          `INSERT INTO unidade_eventos (empresa_id, unidade_id, status_anterior, status_novo, observacao, usuario_id, usuario_nome) VALUES ($1,$2,$3::varchar,$3::varchar,$4,$5,$6)`,
          [empresaId, un.id, un.status, `Devolvida ao ${un.origem}${soAuto ? ' · automático' : ''}`, quem.id, quem.nome]);
      });
      r.feitas.push(un.codigo);
    }
    return r;
  }

  /* ---------- empréstimo automático ---------- */

  private async ambienteOrigem(empresaId: string, ambienteId: string) {
    const [a] = await this.ds.query(`SELECT id, nome, emprestimo FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, empresaId]);
    if (!a) throw new NotFoundException('Ambiente não encontrado.');
    return a as { id: string; nome: string; emprestimo: EmprestimoAuto | null };
  }

  async lerAuto(u: UsuarioToken, ambienteId: string) {
    const a = await this.ambienteOrigem(u.empresaId, ambienteId);
    const c = { ...PADRAO, ...(a.emprestimo ?? {}) };
    const { dentro } = situacaoJanela(c, minutoDaSemana());
    return {
      ativo: c.ativo, destinoId: c.destinoId, categoriaId: c.categoriaId, unidadeIds: c.unidadeIds,
      inicioDia: c.inicioDia, inicioHora: c.inicioHora, fimDia: c.fimDia, fimHora: c.fimHora,
      agoraNaJanela: c.ativo && dentro,
      resumo: `de ${DIAS[c.inicioDia]} ${c.inicioHora} até ${DIAS[c.fimDia]} ${c.fimHora}`,
    };
  }

  async salvarAuto(u: UsuarioToken, ambienteId: string, dto: EmprestimoAutoDto) {
    const a = await this.ambienteOrigem(u.empresaId, ambienteId);
    if (dto.ativo) {
      if (!dto.destinoId || !dto.categoriaId) throw new BadRequestException('Escolha o ambiente e a categoria de destino.');
      if (dto.destinoId === a.id) throw new BadRequestException('O destino tem que ser outro ambiente.');
      await this.destino(u.empresaId, dto.destinoId, dto.categoriaId);
      if (!dto.unidadeIds.length) throw new BadRequestException('Marque os quartos que podem ser emprestados.');
      if (dto.inicioDia * 1440 + minutos(dto.inicioHora) === dto.fimDia * 1440 + minutos(dto.fimHora)) throw new BadRequestException('O início e o fim não podem ser iguais.');
    }
    // só unidades deste ambiente
    const validas: { id: string }[] = dto.unidadeIds.length
      ? await this.ds.query(`SELECT id FROM unidades WHERE empresa_id = $1 AND ambiente_padrao_id = $2 AND id = ANY($3::uuid[])`, [u.empresaId, a.id, dto.unidadeIds])
      : [];
    const antes = { ...PADRAO, ...(a.emprestimo ?? {}) };
    const novo: EmprestimoAuto = {
      ativo: dto.ativo, destinoId: dto.destinoId ?? null, categoriaId: dto.categoriaId ?? null, unidadeIds: validas.map((x) => x.id),
      inicioDia: dto.inicioDia, inicioHora: dto.inicioHora, fimDia: dto.fimDia, fimHora: dto.fimHora,
      // mudou a janela: recomeça o controle
      janela: antes.inicioDia === dto.inicioDia && antes.inicioHora === dto.inicioHora ? antes.janela ?? null : null,
      pendentes: antes.pendentes ?? [],
    };
    await this.ds.query(`UPDATE ambientes SET emprestimo = $2::jsonb WHERE id = $1`, [a.id, JSON.stringify(novo)]);
    // aplica já (se estiver dentro da janela, empresta; se desligou, devolve as automáticas)
    await this.rodarAmbiente(u.empresaId, a.id).catch((e) => this.log.error(e instanceof Error ? e.message : String(e)));
    return this.lerAuto(u, ambienteId);
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.rodar().catch((e) => this.log.error(e instanceof Error ? e.message : String(e))), 5 * 60_000);
    setTimeout(() => void this.rodar().catch(() => undefined), 30_000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** a cada 5 minutos: dentro da janela empresta, fora devolve as emprestadas automaticamente */
  async rodar() {
    const ambs: { id: string; empresa_id: string }[] = await this.ds.query(
      `SELECT id, empresa_id FROM ambientes WHERE emprestimo IS NOT NULL
        OR id IN (SELECT DISTINCT ambiente_padrao_id FROM unidades WHERE emprestimo_auto)`);
    for (const a of ambs) await this.rodarAmbiente(a.empresa_id, a.id).catch((e) => this.log.error(e instanceof Error ? e.message : String(e)));
  }

  private async rodarAmbiente(empresaId: string, ambienteId: string) {
    const [a] = await this.ds.query(`SELECT id, emprestimo FROM ambientes WHERE id = $1 AND empresa_id = $2`, [ambienteId, empresaId]);
    if (!a) return;
    const c: EmprestimoAuto = { ...PADRAO, ...(a.emprestimo ?? {}) };
    const quem: Quem = { id: null, nome: 'Empréstimo automático' };
    const t = minutoDaSemana();
    const s = situacaoJanela(c, t);
    if (c.ativo && s.dentro && c.destinoId && c.categoriaId) {
      // chave da janela: data em que ela começou
      const chave = dataLocal(new Date(Date.now() - s.desdeInicio * 60_000));
      let pendentes = c.janela === chave ? c.pendentes ?? [] : [...c.unidadeIds];
      if (pendentes.length) {
        const ate = dataLocal(new Date(Date.now() + s.faltam * 60_000));
        const r = await this.emprestar(empresaId, pendentes, c.destinoId, c.categoriaId, quem, true, ate);
        const codigos = new Map<string, string>(
          (await this.ds.query(`SELECT id, codigo FROM unidades WHERE id = ANY($1::uuid[])`, [pendentes]) as { id: string; codigo: string }[]).map((x) => [x.codigo, x.id]));
        // ocupada: tenta de novo daqui a pouco; emprestada, com reserva ou já emprestada: sai da fila
        const tentarDeNovo = new Set(r.puladas.filter((p) => p.motivo === 'está ocupada').map((p) => codigos.get(p.codigo)));
        pendentes = pendentes.filter((id) => tentarDeNovo.has(id));
        if (r.feitas.length) this.log.log(`Emprestadas automaticamente: ${r.feitas.join(', ')}`);
      }
      if (c.janela !== chave || (c.pendentes ?? []).length !== pendentes.length) {
        await this.ds.query(`UPDATE ambientes SET emprestimo = emprestimo || $2::jsonb WHERE id = $1`, [a.id, JSON.stringify({ janela: chave, pendentes })]);
      }
      return;
    }
    // fora da janela (ou desligado): devolve as que foram emprestadas automaticamente
    const auto: { id: string }[] = await this.ds.query(`SELECT id FROM unidades WHERE ambiente_padrao_id = $1 AND emprestimo_auto`, [a.id]);
    if (auto.length) {
      const r = await this.devolver(empresaId, auto.map((x) => x.id), quem, true);
      if (r.feitas.length) this.log.log(`Devolvidas automaticamente: ${r.feitas.join(', ')}`);
    }
    if (c.janela) await this.ds.query(`UPDATE ambientes SET emprestimo = emprestimo || '{"janela":null,"pendentes":[]}'::jsonb WHERE id = $1`, [a.id]);
  }
}
