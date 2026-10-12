/**
 * Cálculo da conta de hospedagem por período (motel). Função pura: não acessa banco.
 * Valores sempre em centavos para não ter erro de arredondamento.
 */

export type AposUltimo = 'hora_adicional' | 'pernoite';
export type Modalidade = 'periodo' | 'pernoite';

export interface PeriodoCalc {
  id: string;
  nome: string;
  tipo: 'horas' | 'pernoite';
  duracaoMin: number | null;
  /** "HH:MM" */
  pernoiteInicio: string | null;
  /** "HH:MM" */
  pernoiteFim: string | null;
}

export interface RegrasCalc {
  toleranciaMin: number;
  aposUltimo: AposUltimo;
  pessoasIncluidas: number;
}

export interface PrecosCalc {
  /** preço em centavos por id de período */
  porPeriodo: Record<string, number>;
  /** duração própria desta tabela, por id de período (minutos) */
  duracaoPorPeriodo: Record<string, number>;
  horaAdicional: number;
  pessoaAdicional: number;
}

export interface EntradaCalc {
  periodos: PeriodoCalc[];
  regras: RegrasCalc;
  precos: PrecosCalc;
  modalidade: Modalidade;
  pessoas: number;
  /** minutos de uso já descontado o tempo parado */
  minutosUso: number;
  /** minutos entre a entrada e o fim do pernoite (só para modalidade pernoite) */
  minutosAteFimPernoite: number | null;
}

export interface ResultadoCalc {
  periodoNome: string;
  valorHospedagem: number;
  horasAdicionais: number;
  valorPessoas: number;
  pessoasExtras: number;
  total: number;
  /** minutos até a cobrança mudar (null = não muda mais) */
  proximaViradaMin: number | null;
  proximoNome: string | null;
  /** início e fim (em minutos de uso) do trecho atual, para o anel de progresso */
  trechoInicio: number;
  trechoFim: number | null;
  semPreco: boolean;
}

export function hhmmParaMin(h: string | null | undefined): number | null {
  if (!h) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 24 * 60 ? v : null;
}

export function calcularConta(e: EntradaCalc): ResultadoCalc {
  const tol = Math.max(0, e.regras.toleranciaMin);
  const horas = e.periodos
    .filter((p) => p.tipo === 'horas' && (p.duracaoMin ?? 0) > 0)
    .sort((a, b) => (a.duracaoMin ?? 0) - (b.duracaoMin ?? 0));
  const pernoite = e.periodos.find((p) => p.tipo === 'pernoite') ?? null;
  const preco = (id: string) => e.precos.porPeriodo[id] ?? 0;
  const min = Math.max(0, Math.floor(e.minutosUso));

  const pessoasExtras = Math.max(0, e.pessoas - Math.max(1, e.regras.pessoasIncluidas));
  const valorPessoas = pessoasExtras * e.precos.pessoaAdicional;

  const r: ResultadoCalc = {
    periodoNome: '—',
    valorHospedagem: 0,
    horasAdicionais: 0,
    valorPessoas,
    pessoasExtras,
    total: 0,
    proximaViradaMin: null,
    proximoNome: null,
    trechoInicio: 0,
    trechoFim: null,
    semPreco: false,
  };

  const horaAdicional = (baseMin: number, baseValor: number, baseNome: string) => {
    // passou do limite (base + tolerância): cobra hora cheia a cada 60 min
    const excedente = min - baseMin - tol;
    const qtd = Math.max(1, Math.ceil(excedente / 60));
    r.horasAdicionais = qtd;
    r.valorHospedagem = baseValor + qtd * e.precos.horaAdicional;
    r.periodoNome = `${baseNome} + ${qtd}h`;
    r.trechoInicio = baseMin + tol + (qtd - 1) * 60;
    r.trechoFim = baseMin + tol + qtd * 60;
    r.proximaViradaMin = r.trechoFim - min;
    r.proximoNome = `${baseNome} + ${qtd + 1}h`;
    if (!e.precos.horaAdicional) r.semPreco = true;
  };

  if (e.modalidade === 'pernoite' && pernoite) {
    const fim = Math.max(0, e.minutosAteFimPernoite ?? 0);
    const valor = preco(pernoite.id);
    if (!valor) r.semPreco = true;
    if (min <= fim + tol) {
      r.periodoNome = pernoite.nome;
      r.valorHospedagem = valor;
      r.trechoInicio = 0;
      r.trechoFim = fim + tol;
      r.proximaViradaMin = fim + tol - min;
      r.proximoNome = `${pernoite.nome} + 1h`;
    } else {
      horaAdicional(fim, valor, pernoite.nome);
    }
  } else if (horas.length === 0) {
    r.semPreco = true;
  } else {
    let anterior = 0;
    let achou = false;
    for (let i = 0; i < horas.length; i++) {
      const p = horas[i];
      const limite = (p.duracaoMin ?? 0) + tol;
      if (min <= limite) {
        r.periodoNome = p.nome;
        r.valorHospedagem = preco(p.id);
        if (!r.valorHospedagem) r.semPreco = true;
        r.trechoInicio = anterior;
        r.trechoFim = limite;
        r.proximaViradaMin = limite - min;
        const prox = horas[i + 1];
        r.proximoNome = prox
          ? prox.nome
          : e.regras.aposUltimo === 'pernoite' && pernoite
            ? pernoite.nome
            : `${p.nome} + 1h`;
        achou = true;
        break;
      }
      anterior = limite;
    }
    if (!achou) {
      const ultimo = horas[horas.length - 1];
      if (e.regras.aposUltimo === 'pernoite' && pernoite) {
        r.periodoNome = pernoite.nome;
        r.valorHospedagem = preco(pernoite.id);
        if (!r.valorHospedagem) r.semPreco = true;
        r.trechoInicio = anterior;
        r.trechoFim = null;
        r.proximaViradaMin = null;
        r.proximoNome = null;
      } else {
        horaAdicional(ultimo.duracaoMin ?? 0, preco(ultimo.id), ultimo.nome);
      }
    }
  }

  r.total = r.valorHospedagem + r.valorPessoas;
  return r;
}

/** Partes da data no fuso do estabelecimento. */
export function partesLocais(d: Date, fuso: string): { diaSemana: number; minutoDia: number; data: string } {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const partes = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hora = Number(partes.hour) % 24;
  return {
    diaSemana: dias[partes.weekday] ?? 0,
    minutoDia: hora * 60 + Number(partes.minute),
    data: `${partes.year}-${partes.month}-${partes.day}`,
  };
}

/** Minutos da entrada até o próximo horário de fim do pernoite (no fuso local). */
export function minutosAteHorario(entrada: Date, horario: string | null, fuso: string): number | null {
  const alvo = hhmmParaMin(horario);
  if (alvo === null) return null;
  const { minutoDia } = partesLocais(entrada, fuso);
  let diff = alvo - minutoDia;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

/** Hora local dentro de uma faixa "HH:MM"–"HH:MM" (aceita faixa que vira a noite). */
export function dentroDaFaixa(minutoDia: number, inicio: string | null, fim: string | null): boolean {
  const i = hhmmParaMin(inicio);
  const f = hhmmParaMin(fim);
  if (i === null || f === null) return true;
  if (i === f) return true;
  return i < f ? minutoDia >= i && minutoDia < f : minutoDia >= i || minutoDia < f;
}

export function centavos(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  return Math.round(Number(v) * 100);
}

export function reais(c: number): string {
  return (c / 100).toFixed(2);
}
