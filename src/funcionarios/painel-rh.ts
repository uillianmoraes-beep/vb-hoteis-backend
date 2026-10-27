import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { BancoHorasService } from './banco-horas';
import { FeriasService } from './ferias';
import { ObrigatoriosService } from './obrigatorios';

/**
 * Painel do gestor de RH: a escala de hoje por setor (quem trabalha, folga, falta, atestado, licença ou está sem escala),
 * faltas e atestados do mês, banco de horas, férias e documentos — tudo num lugar só.
 */

const NOME_FUNCAO: Record<string, string> = {
  camareira: 'Camareiras', governanta: 'Governança', recepcionista: 'Recepção', portaria: 'Portaria', garcom: 'Garçons',
  cozinha: 'Cozinha', manutencao: 'Manutenção', gerente: 'Gerência', outro: 'Outros',
};
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

@Injectable()
export class PainelRhService {
  constructor(
    private readonly ds: DataSource,
    private readonly banco: BancoHorasService,
    private readonly ferias: FeriasService,
    private readonly obrigatorios: ObrigatoriosService,
  ) {}

  async painel(u: UsuarioToken, dataQ?: string) {
    const data = dataQ && /^\d{4}-\d{2}-\d{2}$/.test(dataQ) ? dataQ : hojeSP();
    const mes = data.slice(0, 7);
    const funcs: { id: string; nome: string; funcao: string; admissao: string | null; tipo_contrato: string | null }[] = await this.ds.query(
      `SELECT f.id, f.nome, f.funcao, to_char(f.admissao, 'YYYY-MM-DD') AS admissao, c.tipo_contrato FROM funcionarios f
         LEFT JOIN funcionario_contratos c ON c.funcionario_id = f.id WHERE f.empresa_id = $1 AND f.ativo ORDER BY f.nome`, [u.empresaId])
      .catch(() => this.ds.query(`SELECT id, nome, funcao, NULL AS admissao, NULL AS tipo_contrato FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY nome`, [u.empresaId]));
    const escala: { funcionario_id: string; tipo: string; inicio: string | null; fim: string | null; turno: string | null }[] = await this.ds.query(
      `SELECT e.funcionario_id, e.tipo, e.inicio, e.fim, t.nome AS turno FROM escala_dias e LEFT JOIN escala_turnos t ON t.id = e.turno_id
        WHERE e.empresa_id = $1 AND e.data = $2`, [u.empresaId, data]);
    const licencas: { funcionario_id: string; tipo: string; fim: string | null }[] = await this.ds.query(
      `SELECT funcionario_id, tipo, to_char(fim, 'YYYY-MM-DD') AS fim FROM funcionario_licencas WHERE empresa_id = $1 AND inicio <= $2 AND (fim IS NULL OR fim >= $2)`, [u.empresaId, data]).catch(() => []);
    const programadas = (await this.ferias.ferias(u)).calendario.filter((p) => p.inicio <= data && p.fim >= data).map((p) => p.funcionarioId);

    // hoje, por setor
    const situacao = (f: { id: string }) => {
      if (programadas.includes(f.id)) return { estado: 'ferias', texto: 'Férias' };
      const l = licencas.find((x) => x.funcionario_id === f.id);
      if (l) return { estado: 'licenca', texto: `Licença (${l.tipo})${l.fim ? ` até ${l.fim.split('-').reverse().join('/')}` : ''}` };
      const e = escala.find((x) => x.funcionario_id === f.id);
      if (!e) return { estado: 'sem_escala', texto: 'Sem escala' };
      if (e.tipo === 'trabalho') return { estado: 'trabalho', texto: e.inicio && e.fim ? `${e.inicio}–${e.fim}${e.turno ? ` (${e.turno})` : ''}` : e.turno ?? 'Trabalho' };
      return { estado: e.tipo, texto: { folga: 'Folga', falta: 'Falta', atestado: 'Atestado', compensa: 'Folga do banco de horas' }[e.tipo] ?? e.tipo };
    };
    const setores = new Map<string, { funcao: string; nome: string; pessoas: { id: string; nome: string; estado: string; texto: string }[] }>();
    for (const f of funcs) {
      const s = setores.get(f.funcao) ?? { funcao: f.funcao, nome: NOME_FUNCAO[f.funcao] ?? f.funcao, pessoas: [] };
      s.pessoas.push({ id: f.id, nome: f.nome, ...situacao(f) });
      setores.set(f.funcao, s);
    }
    const listaSetores = [...setores.values()].map((s) => ({
      ...s,
      trabalhando: s.pessoas.filter((p) => p.estado === 'trabalho').length,
      ausentes: s.pessoas.filter((p) => ['falta', 'atestado', 'licenca', 'ferias'].includes(p.estado)).length,
      semEscala: s.pessoas.filter((p) => p.estado === 'sem_escala').length,
    })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const todas = listaSetores.flatMap((s) => s.pessoas);

    // faltas e atestados do mês
    const mesRows: { funcionario_id: string; faltas: number; atestados: number }[] = await this.ds.query(
      `SELECT funcionario_id, count(*) FILTER (WHERE tipo = 'falta')::int AS faltas, count(*) FILTER (WHERE tipo = 'atestado')::int AS atestados
         FROM escala_dias WHERE empresa_id = $1 AND to_char(data, 'YYYY-MM') = $2 AND data <= $3 GROUP BY 1`, [u.empresaId, mes, data]);
    const nome = new Map(funcs.map((f) => [f.id, f.nome]));
    const ausencias = mesRows.filter((x) => x.faltas || x.atestados).map((x) => ({ id: x.funcionario_id, nome: nome.get(x.funcionario_id) ?? '—', faltas: x.faltas, atestados: x.atestados }))
      .sort((a, b) => b.faltas - a.faltas || b.atestados - a.atestados);

    // banco de horas, férias e documentos (os mesmos números das telas de cada assunto)
    const [bh, fe, doc] = await Promise.all([
      this.banco.resumo(u).catch(() => null),
      this.ferias.ferias(u).catch(() => null),
      this.obrigatorios.checklist(u).catch(() => null),
    ]);
    const banco = bh ? {
      positivo: bh.lista.filter((f) => f.saldo > 0).reduce((s, f) => s + f.saldo, 0),
      negativo: bh.lista.filter((f) => f.saldo < 0).reduce((s, f) => s + f.saldo, 0),
      vencendo: bh.lista.reduce((s, f) => s + (f.vencendo ?? 0), 0),
      vencidas: bh.lista.reduce((s, f) => s + (f.vencidas ?? 0), 0),
      maiores: [...bh.lista].sort((a, b) => Math.abs(b.saldo) - Math.abs(a.saldo)).slice(0, 5).filter((f) => f.saldo).map((f) => ({ id: f.id, nome: f.nome, saldo: f.saldo, vencendo: f.vencendo ?? 0 })),
    } : null;
    const ferias = fe ? {
      vencidos: fe.resumo.vencidos, alertas: fe.resumo.alertas, emFerias: fe.resumo.emFerias, valorAberto: fe.resumo.valorAberto,
      lista: fe.lista.filter((f) => f.alerta).slice(0, 8).map((f) => ({ id: f.id, nome: f.nome, vencidos: f.vencidos })),
    } : null;
    // contrato de experiência terminando nos próximos 15 dias (45 e 90 dias da admissão)
    const experiencia = funcs.filter((f) => f.admissao && /experi/i.test(f.tipo_contrato ?? '')).flatMap((f) => [45, 90].map((n) => {
      const fim = new Date(Date.parse(`${f.admissao}T12:00:00Z`) + (n - 1) * 86_400_000).toISOString().slice(0, 10);
      const dias = Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${data}T12:00:00Z`)) / 86_400_000);
      return { id: f.id, nome: f.nome, marco: n, fim, dias };
    })).filter((x) => x.dias >= 0 && x.dias <= 15);
    const [aniv] = await this.ds.query(`SELECT count(*)::int AS n FROM funcionarios WHERE empresa_id = $1 AND ativo AND to_char(nascimento, 'MM') = $2`, [u.empresaId, data.slice(5, 7)]).catch(() => [{ n: 0 }]);

    return {
      data,
      hoje: {
        equipe: funcs.length,
        trabalhando: todas.filter((p) => p.estado === 'trabalho').length,
        folga: todas.filter((p) => p.estado === 'folga' || p.estado === 'compensa').length,
        faltas: todas.filter((p) => p.estado === 'falta').length,
        atestados: todas.filter((p) => p.estado === 'atestado').length,
        afastados: todas.filter((p) => p.estado === 'licenca' || p.estado === 'ferias').length,
        semEscala: todas.filter((p) => p.estado === 'sem_escala').length,
      },
      setores: listaSetores,
      mes: { competencia: mes, faltas: ausencias.reduce((s, x) => s + x.faltas, 0), atestados: ausencias.reduce((s, x) => s + x.atestados, 0), ausencias: ausencias.slice(0, 10) },
      banco, ferias,
      documentos: doc ? doc.resumo : null,
      experiencia,
      aniversariantes: Number(aniv?.n ?? 0),
    };
  }
}

@Controller('rh/painel')
export class PainelRhController {
  constructor(private readonly service: PainelRhService) {}

  @Get()
  @Requer('funcionarios.gerenciar', 'funcionarios.financeiro')
  painel(@Usuario() u: UsuarioToken, @Query('data') data?: string) {
    return this.service.painel(u, data);
  }
}
