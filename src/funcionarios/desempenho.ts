import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { randomBytes } from 'crypto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { Publico } from '../common/decorators/publico.decorator';
import { UsuarioToken } from '../common/permissoes';
import { FUNCOES } from './funcionario.entity';

/**
 * Avaliação profissional (a gerente avalia cada funcionário com o questionário do setor dele, nota de 1 a 5 por pergunta)
 * e seleção de pessoal (candidatos, entrevista com roteiro e uma prova simples que o candidato pode fazer pelo celular).
 * Os questionários vêm prontos por setor e cada hotel muda como quiser.
 */

const r1 = (v: number) => Math.round(v * 10) / 10;
const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const SETORES: Record<string, string> = {
  todos: 'Todos os setores', camareira: 'Camareira', governanta: 'Governança', recepcionista: 'Recepção', portaria: 'Portaria', garcom: 'Garçom / salão',
  cozinha: 'Cozinha', manutencao: 'Manutenção', gerente: 'Gerência', outro: 'Outros',
};
const COMUNS = ['Pontualidade (chega no horário, respeita o intervalo)', 'Assiduidade (não falta sem motivo)', 'Apresentação pessoal e uniforme', 'Educação com hóspedes e colegas',
  'Trabalho em equipe', 'Iniciativa (resolve sem precisar mandar)', 'Cumpre as regras da casa', 'Cuidado com o patrimônio e com o material'];
const POR_SETOR: Record<string, string[]> = {
  camareira: ['Qualidade da limpeza (passa na vistoria)', 'Tempo de arrumação da suíte/quarto', 'Reposição de frigobar e amenities', 'Cuidado com o enxoval', 'Avisa os problemas de manutenção'],
  governanta: ['Organização da equipe de limpeza', 'Conferência das suítes/quartos', 'Controle do enxoval e da lavanderia', 'Treina e corrige a equipe'],
  recepcionista: ['Atendimento e simpatia', 'Agilidade na entrada e na saída', 'Cuidado com o caixa (sem diferença)', 'Uso do sistema', 'Oferece upgrade e consumo'],
  portaria: ['Atendimento na chegada', 'Controle de entrada e saída', 'Atenção à segurança', 'Comunicação com a recepção'],
  garcom: ['Atendimento à mesa / nas suítes', 'Agilidade na entrega dos pedidos', 'Conhecimento do cardápio', 'Lança tudo na conta (sem perda)'],
  cozinha: ['Higiene e manipulação de alimentos', 'Tempo de preparo', 'Apresentação dos pratos', 'Controle de desperdício e validade'],
  manutencao: ['Resolve no prazo', 'Qualidade do serviço', 'Cuidado com as ferramentas', 'Manutenção preventiva', 'Deixa o local limpo depois do serviço'],
  gerente: ['Liderança da equipe', 'Organização e planejamento', 'Resolução de problemas e reclamações', 'Controle de custos e do caixa'],
  outro: [],
};
const ROTEIRO = [
  'Conte sobre as suas últimas experiências de trabalho.', 'Por que saiu (ou quer sair) do último emprego?', 'Tem disponibilidade para noite, fim de semana e feriado? Para escala 12x36 ou 6x1?',
  'Como você atende um cliente nervoso ou reclamando?', 'O que é um bom atendimento para você?', 'Onde mora e como vem para o trabalho?', 'Qual a sua pretensão de salário?', 'Quando pode começar?',
];
/** prova simples: contas do dia a dia, português, atendimento e bom senso */
const PROVA = [
  { pergunta: 'A conta deu R$ 87,50 e o cliente pagou com uma nota de R$ 100,00. Qual é o troco?', opcoes: ['R$ 12,50', 'R$ 13,50', 'R$ 22,50', 'R$ 12,00'], correta: 0 },
  { pergunta: 'Quanto é 10% de R$ 250,00?', opcoes: ['R$ 2,50', 'R$ 25,00', 'R$ 10,00', 'R$ 50,00'], correta: 1 },
  { pergunta: 'Uma suíte custa R$ 60,00 por 2 horas. Quanto custam 3 suítes?', opcoes: ['R$ 120,00', 'R$ 160,00', 'R$ 180,00', 'R$ 200,00'], correta: 2 },
  { pergunta: 'Qual frase está escrita corretamente?', opcoes: ['Seja bem vindo ao nosso hotel.', 'Seja bem-vindo ao nosso hotel.', 'Seja bem vindo ao noso hotel.', 'Seja bein-vindo ao nosso hotel.'], correta: 1 },
  { pergunta: 'Qual palavra está certa?', opcoes: ['Excessão', 'Exceção', 'Esceção', 'Exseção'], correta: 1 },
  { pergunta: 'Um hóspede reclama, nervoso, que o ar-condicionado não funciona. O que fazer primeiro?', opcoes: ['Dizer que não é culpa sua', 'Ouvir com calma, pedir desculpas e chamar a manutenção ou oferecer outro quarto', 'Pedir para ele voltar mais tarde', 'Ignorar'], correta: 1 },
  { pergunta: 'Você encontrou um celular esquecido na suíte. O que faz?', opcoes: ['Guarda para você', 'Entrega para a recepção/gerência e registra no achados e perdidos', 'Deixa no quarto', 'Liga para os seus contatos'], correta: 1 },
  { pergunta: 'O seu turno começa às 7h. Que horas é bom chegar?', opcoes: ['7h30', 'Um pouco antes das 7h, para trocar de roupa e começar no horário', '8h', 'Quando der'], correta: 1 },
  { pergunta: 'Se você tiver uma dúvida sobre uma tarefa, o melhor é:', opcoes: ['Fazer do seu jeito', 'Perguntar para o responsável', 'Não fazer', 'Esperar alguém notar'], correta: 1 },
  { pergunta: 'O cliente pediu 2 refrigerantes de R$ 7,00 e 1 porção de R$ 35,00. Qual o total?', opcoes: ['R$ 42,00', 'R$ 49,00', 'R$ 47,00', 'R$ 52,00'], correta: 1 },
];

class PerguntaDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsString() @MinLength(2) @MaxLength(200) texto!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) peso?: number;
}
class ModeloDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsIn(Object.keys(SETORES)) setor!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => PerguntaDto) perguntas!: PerguntaDto[];
}
class RespostaDto {
  @IsString() @MaxLength(40) perguntaId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) nota?: number;
  @IsOptional() @IsString() @MaxLength(500) comentario?: string;
}
class AvaliacaoDto {
  @IsUUID() funcionarioId!: string;
  @IsUUID() modeloId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) periodo!: string;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => RespostaDto) respostas!: RespostaDto[];
  @IsOptional() @IsString() @MaxLength(1000) pontosFortes?: string;
  @IsOptional() @IsString() @MaxLength(1000) melhorar?: string;
  @IsOptional() @IsString() @MaxLength(1000) plano?: string;
}
class QuestaoDto {
  @IsString() @MinLength(2) @MaxLength(300) pergunta!: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(200, { each: true }) opcoes!: string[];
  @IsInt() @Min(0) @Max(5) correta!: number;
}
class SelecaoModeloDto {
  @IsString() @MinLength(2) @MaxLength(80) nome!: string;
  @IsIn(Object.keys(SETORES)) setor!: string;
  @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) @MaxLength(300, { each: true }) roteiro!: string[];
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => QuestaoDto) prova!: QuestaoDto[];
}
class CandidatoDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(30) telefone?: string;
  @IsOptional() @IsEmail() @MaxLength(160) email?: string;
  @IsIn(Object.keys(SETORES)) setor!: string;
  @IsOptional() @IsString() @MaxLength(80) vaga?: string;
  @IsOptional() @IsString() @MaxLength(80) origem?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}
class StatusCandidatoDto { @IsIn(['novo', 'entrevistado', 'aprovado', 'reprovado', 'desistiu']) status!: string }
class EntrevistaDto {
  @IsUUID() modeloId!: string;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => RespostaDto) respostas!: RespostaDto[];
  @IsOptional() @IsString() @MaxLength(1500) parecer?: string;
  @IsOptional() @IsIn(['aprovado', 'reprovado', 'reserva']) resultado?: string;
}
class ProvaRespostasDto {
  @IsArray() @ArrayMaxSize(40) @IsInt({ each: true }) @Min(-1, { each: true }) @Max(5, { each: true }) respostas!: number[];
  @IsOptional() @IsBoolean() confirmo?: boolean;
}

interface Pergunta { id: string; texto: string; peso: number }

@Injectable()
export class DesempenhoService {
  constructor(private readonly ds: DataSource) {}

  /** primeira vez: cria os questionários prontos (um por setor) e o modelo de entrevista com a prova */
  private async semear(empresaId: string) {
    const [tem] = await this.ds.query(`SELECT 1 FROM rh_questionarios WHERE empresa_id = $1 LIMIT 1`, [empresaId]);
    if (tem) return;
    let k = 0;
    const pergs = (lista: string[]) => lista.map((t) => ({ id: `p${++k}`, texto: t, peso: 1 }));
    for (const s of ['camareira', 'governanta', 'recepcionista', 'portaria', 'garcom', 'cozinha', 'manutencao', 'gerente']) {
      await this.ds.query(`INSERT INTO rh_questionarios (empresa_id, tipo, nome, setor, perguntas) VALUES ($1,'avaliacao',$2,$3,$4)`,
        [empresaId, `Avaliação · ${SETORES[s]}`, s, JSON.stringify(pergs([...COMUNS, ...POR_SETOR[s]]))]);
    }
    await this.ds.query(`INSERT INTO rh_questionarios (empresa_id, tipo, nome, setor, perguntas) VALUES ($1,'avaliacao','Avaliação geral','todos',$2)`, [empresaId, JSON.stringify(pergs(COMUNS))]);
    await this.ds.query(`INSERT INTO rh_questionarios (empresa_id, tipo, nome, setor, perguntas, prova) VALUES ($1,'entrevista','Entrevista padrão','todos',$2,$3)`,
      [empresaId, JSON.stringify(pergs(ROTEIRO)), JSON.stringify(PROVA)]);
  }

  async questionarios(u: UsuarioToken) {
    await this.semear(u.empresaId);
    const l = await this.ds.query(`SELECT * FROM rh_questionarios WHERE empresa_id = $1 AND ativo ORDER BY tipo, setor = 'todos', nome`, [u.empresaId]);
    return {
      setores: SETORES, funcoes: FUNCOES,
      lista: l.map((q: Record<string, unknown>) => ({ id: q.id, tipo: q.tipo, nome: q.nome, setor: q.setor, perguntas: q.perguntas, prova: q.prova ?? [] })),
    };
  }

  private normalizar(ps: PerguntaDto[]) {
    const usados = new Set<string>();
    return ps.map((p, i) => {
      let id = p.id && /^[a-z0-9]+$/i.test(p.id) && !usados.has(p.id) ? p.id : `q${Date.now().toString(36)}${i}`;
      while (usados.has(id)) id += 'x';
      usados.add(id);
      return { id, texto: p.texto.trim(), peso: p.peso ?? 1 };
    });
  }

  async salvarModelo(u: UsuarioToken, dto: ModeloDto, id?: string) {
    const perguntas = JSON.stringify(this.normalizar(dto.perguntas));
    if (id) {
      const r = await this.ds.query(`UPDATE rh_questionarios SET nome=$3, setor=$4, perguntas=$5 WHERE id=$1 AND empresa_id=$2 AND tipo='avaliacao' RETURNING id`, [id, u.empresaId, dto.nome.trim(), dto.setor, perguntas]);
      if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Questionário não encontrado.');
      return { ok: true, id };
    }
    const [r] = await this.ds.query(`INSERT INTO rh_questionarios (empresa_id, tipo, nome, setor, perguntas) VALUES ($1,'avaliacao',$2,$3,$4) RETURNING id`, [u.empresaId, dto.nome.trim(), dto.setor, perguntas]);
    return { ok: true, id: r.id };
  }

  async salvarSelecao(u: UsuarioToken, dto: SelecaoModeloDto, id?: string) {
    const roteiro = JSON.stringify(this.normalizar(dto.roteiro.filter((t) => t.trim()).map((texto) => ({ texto }))));
    const prova = JSON.stringify(dto.prova.map((q) => {
      if (q.correta >= q.opcoes.length) throw new BadRequestException(`A resposta certa de "${q.pergunta.slice(0, 40)}" não está entre as opções.`);
      return { pergunta: q.pergunta.trim(), opcoes: q.opcoes.map((o) => o.trim()), correta: q.correta };
    }));
    if (id) {
      const r = await this.ds.query(`UPDATE rh_questionarios SET nome=$3, setor=$4, perguntas=$5, prova=$6 WHERE id=$1 AND empresa_id=$2 AND tipo='entrevista' RETURNING id`, [id, u.empresaId, dto.nome.trim(), dto.setor, roteiro, prova]);
      if (!(Array.isArray(r?.[0]) ? r[0].length : r?.length)) throw new NotFoundException('Modelo não encontrado.');
      return { ok: true, id };
    }
    const [r] = await this.ds.query(`INSERT INTO rh_questionarios (empresa_id, tipo, nome, setor, perguntas, prova) VALUES ($1,'entrevista',$2,$3,$4,$5) RETURNING id`, [u.empresaId, dto.nome.trim(), dto.setor, roteiro, prova]);
    return { ok: true, id: r.id };
  }

  async removerModelo(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE rh_questionarios SET ativo = false WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  private nota(perguntas: Pergunta[], respostas: { perguntaId: string; nota?: number }[]) {
    let soma = 0, pesos = 0;
    for (const p of perguntas) {
      const r = respostas.find((x) => x.perguntaId === p.id);
      if (!r?.nota) continue;
      soma += r.nota * (p.peso || 1); pesos += p.peso || 1;
    }
    // média de 1 a 5 vira nota de 0 a 10
    return pesos ? r1(((soma / pesos - 1) / 4) * 10) : null;
  }

  /* ---------------- avaliação profissional ---------------- */

  async avaliacoes(u: UsuarioToken, periodoQ?: string) {
    await this.semear(u.empresaId);
    const periodo = periodoQ && /^\d{4}-\d{2}$/.test(periodoQ) ? periodoQ : hojeSP().slice(0, 7);
    const fs: { id: string; nome: string; funcao: string }[] = await this.ds.query(`SELECT id, nome, funcao FROM funcionarios WHERE empresa_id = $1 AND ativo ORDER BY funcao, nome`, [u.empresaId]);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT a.id, a.funcionario_id, a.periodo, a.nota, a.avaliador_nome, a.criado_em, a.ciente_em, q.nome AS questionario FROM rh_avaliacoes a LEFT JOIN rh_questionarios q ON q.id = a.questionario_id
        WHERE a.empresa_id = $1 ORDER BY a.periodo DESC, a.criado_em DESC`, [u.empresaId]);
    const doPeriodo = new Map(l.filter((a) => a.periodo === periodo).map((a) => [a.funcionario_id as string, a]));
    const historico = (id: string) => l.filter((a) => a.funcionario_id === id).slice(0, 6).map((a) => ({ periodo: a.periodo, nota: a.nota === null ? null : Number(a.nota) }));
    const lista = fs.map((f) => {
      const a = doPeriodo.get(f.id);
      return {
        id: f.id, nome: f.nome, funcao: f.funcao, setor: SETORES[f.funcao] ?? f.funcao,
        avaliacao: a ? { id: a.id, nota: a.nota === null ? null : Number(a.nota), avaliador: a.avaliador_nome, em: a.criado_em, ciente: !!a.ciente_em, questionario: a.questionario } : null,
        historico: historico(f.id),
      };
    });
    const porSetor = Object.entries(lista.reduce((m, f) => {
      if (f.avaliacao?.nota !== null && f.avaliacao?.nota !== undefined) { (m[f.setor] ??= []).push(f.avaliacao.nota); }
      return m;
    }, {} as Record<string, number[]>)).map(([setor, notas]) => ({ setor, media: r1(notas.reduce((s, x) => s + x, 0) / notas.length), avaliados: notas.length }));
    return { periodo, lista, porSetor, faltam: lista.filter((f) => !f.avaliacao).length };
  }

  async avaliacao(u: UsuarioToken, id: string) {
    const [a] = await this.ds.query(
      `SELECT a.*, f.nome, f.funcao, q.nome AS questionario, q.perguntas FROM rh_avaliacoes a JOIN funcionarios f ON f.id = a.funcionario_id LEFT JOIN rh_questionarios q ON q.id = a.questionario_id WHERE a.id = $1 AND a.empresa_id = $2`, [id, u.empresaId]);
    if (!a) throw new NotFoundException('Avaliação não encontrada.');
    return {
      id: a.id, funcionarioId: a.funcionario_id, nome: a.nome, setor: SETORES[a.funcao] ?? a.funcao, periodo: a.periodo, questionario: a.questionario, questionarioId: a.questionario_id,
      perguntas: a.perguntas_usadas ?? a.perguntas ?? [], respostas: a.respostas, nota: a.nota === null ? null : Number(a.nota), pontosFortes: a.pontos_fortes, melhorar: a.melhorar, plano: a.plano,
      avaliador: a.avaliador_nome, em: a.criado_em, cienteEm: a.ciente_em,
    };
  }

  async avaliar(u: UsuarioToken, dto: AvaliacaoDto) {
    const [f] = await this.ds.query(`SELECT id FROM funcionarios WHERE id = $1 AND empresa_id = $2`, [dto.funcionarioId, u.empresaId]);
    if (!f) throw new NotFoundException('Funcionário não encontrado.');
    const [q] = await this.ds.query(`SELECT perguntas FROM rh_questionarios WHERE id = $1 AND empresa_id = $2 AND tipo = 'avaliacao'`, [dto.modeloId, u.empresaId]);
    if (!q) throw new NotFoundException('Questionário não encontrado.');
    const perguntas = q.perguntas as Pergunta[];
    const respostas = dto.respostas.filter((r) => perguntas.some((p) => p.id === r.perguntaId));
    if (!respostas.some((r) => r.nota)) throw new BadRequestException('Dê nota em pelo menos uma pergunta.');
    const nota = this.nota(perguntas, respostas);
    const [r] = await this.ds.query(
      `INSERT INTO rh_avaliacoes (empresa_id, funcionario_id, questionario_id, periodo, perguntas_usadas, respostas, nota, pontos_fortes, melhorar, plano, avaliador_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (funcionario_id, periodo) DO UPDATE SET questionario_id=$3, perguntas_usadas=$5, respostas=$6, nota=$7, pontos_fortes=$8, melhorar=$9, plano=$10, avaliador_nome=$11, criado_em=now(), ciente_em=NULL
       RETURNING id`,
      [u.empresaId, dto.funcionarioId, dto.modeloId, dto.periodo, JSON.stringify(perguntas), JSON.stringify(respostas), nota, dto.pontosFortes?.trim() || null, dto.melhorar?.trim() || null, dto.plano?.trim() || null, u.nome]);
    return { ok: true, id: r.id, nota };
  }

  async ciente(u: UsuarioToken, id: string) {
    await this.ds.query(`UPDATE rh_avaliacoes SET ciente_em = now() WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    return { ok: true };
  }

  /* ---------------- seleção: candidatos, entrevista e prova ---------------- */

  async candidatos(u: UsuarioToken) {
    await this.semear(u.empresaId);
    const l: Record<string, unknown>[] = await this.ds.query(
      `SELECT c.*, (SELECT row_to_json(e) FROM (SELECT id, nota_entrevista, prova_acertos, prova_total, resultado, entrevistador_nome, criado_em FROM rh_entrevistas WHERE candidato_id = c.id ORDER BY criado_em DESC LIMIT 1) e) AS entrevista,
              (SELECT row_to_json(p) FROM (SELECT token, acertos, total, respondida_em, expira_em FROM rh_provas WHERE candidato_id = c.id ORDER BY criado_em DESC LIMIT 1) p) AS prova
         FROM rh_candidatos c WHERE c.empresa_id = $1 ORDER BY c.status IN ('reprovado','desistiu','contratado'), c.criado_em DESC LIMIT 300`, [u.empresaId]);
    return {
      setores: SETORES,
      lista: l.map((c) => ({
        id: c.id, nome: c.nome, telefone: c.telefone, email: c.email, setor: c.setor, setorNome: SETORES[c.setor as string] ?? c.setor, vaga: c.vaga, origem: c.origem, observacao: c.observacao,
        status: c.status, funcionarioId: c.funcionario_id ?? null, em: c.criado_em, entrevista: c.entrevista ?? null, prova: c.prova ?? null,
      })),
    };
  }

  async salvarCandidato(u: UsuarioToken, dto: CandidatoDto, id?: string) {
    const campos = [dto.nome.trim(), dto.telefone?.trim() || null, dto.email?.trim() || null, dto.setor, dto.vaga?.trim() || null, dto.origem?.trim() || null, dto.observacao?.trim() || null];
    if (id) {
      await this.ds.query(`UPDATE rh_candidatos SET nome=$3, telefone=$4, email=$5, setor=$6, vaga=$7, origem=$8, observacao=$9 WHERE id=$1 AND empresa_id=$2`, [id, u.empresaId, ...campos]);
      return { ok: true, id };
    }
    const [r] = await this.ds.query(`INSERT INTO rh_candidatos (empresa_id, nome, telefone, email, setor, vaga, origem, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [u.empresaId, ...campos, u.nome]);
    return { ok: true, id: r.id };
  }

  async statusCandidato(u: UsuarioToken, id: string, dto: StatusCandidatoDto) {
    await this.ds.query(`UPDATE rh_candidatos SET status = $3 WHERE id = $1 AND empresa_id = $2 AND status <> 'contratado'`, [id, u.empresaId, dto.status]);
    return { ok: true };
  }

  /** gera o link da prova para o candidato fazer pelo celular (vale 7 dias, uma vez só) */
  async gerarProva(u: UsuarioToken, candidatoId: string, modeloId: string) {
    const [c] = await this.ds.query(`SELECT id FROM rh_candidatos WHERE id = $1 AND empresa_id = $2`, [candidatoId, u.empresaId]);
    if (!c) throw new NotFoundException('Candidato não encontrado.');
    const [q] = await this.ds.query(`SELECT prova FROM rh_questionarios WHERE id = $1 AND empresa_id = $2 AND tipo = 'entrevista'`, [modeloId, u.empresaId]);
    if (!q || !(q.prova ?? []).length) throw new BadRequestException('Este modelo não tem prova.');
    const token = randomBytes(18).toString('base64url');
    await this.ds.query(`INSERT INTO rh_provas (empresa_id, candidato_id, questionario_id, token, questoes, total, expira_em) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '7 days')`,
      [u.empresaId, candidatoId, modeloId, token, JSON.stringify(q.prova), q.prova.length]);
    return { ok: true, token };
  }

  async provaPublica(token: string) {
    const [p] = await this.ds.query(`SELECT p.*, c.nome, e.nome AS empresa FROM rh_provas p JOIN rh_candidatos c ON c.id = p.candidato_id JOIN empresas e ON e.id = p.empresa_id WHERE p.token = $1`, [token]);
    if (!p) throw new NotFoundException('Prova não encontrada.');
    if (p.respondida_em) return { respondida: true, nome: p.nome, empresa: p.empresa };
    if (new Date(p.expira_em) < new Date()) throw new BadRequestException('Este link venceu. Peça um novo para quem fez a sua entrevista.');
    return { respondida: false, nome: p.nome, empresa: p.empresa, questoes: (p.questoes as { pergunta: string; opcoes: string[] }[]).map((x) => ({ pergunta: x.pergunta, opcoes: x.opcoes })) };
  }

  async responderProva(token: string, dto: ProvaRespostasDto) {
    const [p] = await this.ds.query(`SELECT * FROM rh_provas WHERE token = $1`, [token]);
    if (!p) throw new NotFoundException('Prova não encontrada.');
    if (p.respondida_em) throw new BadRequestException('Esta prova já foi respondida.');
    if (new Date(p.expira_em) < new Date()) throw new BadRequestException('Este link venceu.');
    const qs = p.questoes as { correta: number }[];
    const respostas = qs.map((_, i) => (Number.isInteger(dto.respostas[i]) ? dto.respostas[i] : -1));
    const acertos = qs.reduce((s, q, i) => s + (respostas[i] === q.correta ? 1 : 0), 0);
    await this.ds.query(`UPDATE rh_provas SET respostas = $2, acertos = $3, respondida_em = now() WHERE id = $1 AND respondida_em IS NULL`, [p.id, JSON.stringify(respostas), acertos]);
    return { ok: true };
  }

  async entrevistar(u: UsuarioToken, candidatoId: string, dto: EntrevistaDto) {
    const [c] = await this.ds.query(`SELECT id FROM rh_candidatos WHERE id = $1 AND empresa_id = $2`, [candidatoId, u.empresaId]);
    if (!c) throw new NotFoundException('Candidato não encontrado.');
    const [q] = await this.ds.query(`SELECT perguntas FROM rh_questionarios WHERE id = $1 AND empresa_id = $2 AND tipo = 'entrevista'`, [dto.modeloId, u.empresaId]);
    if (!q) throw new NotFoundException('Modelo não encontrado.');
    const perguntas = q.perguntas as Pergunta[];
    const [prova] = await this.ds.query(`SELECT acertos, total FROM rh_provas WHERE candidato_id = $1 AND respondida_em IS NOT NULL ORDER BY respondida_em DESC LIMIT 1`, [candidatoId]);
    const nota = this.nota(perguntas, dto.respostas);
    const [r] = await this.ds.query(
      `INSERT INTO rh_entrevistas (empresa_id, candidato_id, questionario_id, perguntas_usadas, respostas, nota_entrevista, prova_acertos, prova_total, parecer, resultado, entrevistador_nome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [u.empresaId, candidatoId, dto.modeloId, JSON.stringify(perguntas), JSON.stringify(dto.respostas), nota, prova ? Number(prova.acertos) : null, prova ? Number(prova.total) : null,
        dto.parecer?.trim() || null, dto.resultado ?? null, u.nome]);
    const status = dto.resultado === 'aprovado' ? 'aprovado' : dto.resultado === 'reprovado' ? 'reprovado' : 'entrevistado';
    await this.ds.query(`UPDATE rh_candidatos SET status = $2 WHERE id = $1 AND status <> 'contratado'`, [candidatoId, status]);
    return { ok: true, id: r.id, nota };
  }

  async fichaCandidato(u: UsuarioToken, id: string) {
    const [c] = await this.ds.query(`SELECT * FROM rh_candidatos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Candidato não encontrado.');
    const entrevistas = await this.ds.query(`SELECT * FROM rh_entrevistas WHERE candidato_id = $1 ORDER BY criado_em DESC`, [id]);
    const provas = await this.ds.query(`SELECT token, questoes, respostas, acertos, total, respondida_em, expira_em, criado_em FROM rh_provas WHERE candidato_id = $1 ORDER BY criado_em DESC`, [id]);
    return {
      id: c.id, nome: c.nome, telefone: c.telefone, email: c.email, setor: c.setor, setorNome: SETORES[c.setor] ?? c.setor, vaga: c.vaga, origem: c.origem, observacao: c.observacao, status: c.status, funcionarioId: c.funcionario_id,
      entrevistas: entrevistas.map((e: Record<string, unknown>) => ({ id: e.id, perguntas: e.perguntas_usadas, respostas: e.respostas, nota: e.nota_entrevista === null ? null : Number(e.nota_entrevista),
        provaAcertos: e.prova_acertos, provaTotal: e.prova_total, parecer: e.parecer, resultado: e.resultado, entrevistador: e.entrevistador_nome, em: e.criado_em })),
      provas: provas.map((p: Record<string, unknown>) => ({ token: p.token, questoes: p.questoes, respostas: p.respostas, acertos: p.acertos, total: p.total, respondidaEm: p.respondida_em, expiraEm: p.expira_em, em: p.criado_em })),
    };
  }

  /** aprovado → vira funcionário (cadastro com nome, telefone e função; o resto se completa na ficha) */
  async contratar(u: UsuarioToken, id: string) {
    const [c] = await this.ds.query(`SELECT * FROM rh_candidatos WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Candidato não encontrado.');
    if (c.funcionario_id) throw new BadRequestException('Já foi contratado.');
    const funcao = (FUNCOES as readonly string[]).includes(c.setor) ? c.setor : 'outro';
    const [f] = await this.ds.query(
      `INSERT INTO funcionarios (empresa_id, matricula, nome, funcao, telefone, admissao, observacao) VALUES ($1, (SELECT COALESCE(max(matricula),0)+1 FROM funcionarios WHERE empresa_id = $1), $2, $3, $4, $5, $6) RETURNING id`,
      [u.empresaId, c.nome, funcao, c.telefone, hojeSP(), `Contratado pela seleção (${c.vaga ?? SETORES[c.setor] ?? ''})`.slice(0, 300)]);
    await this.ds.query(`UPDATE rh_candidatos SET status = 'contratado', funcionario_id = $2 WHERE id = $1`, [id, f.id]);
    return { ok: true, funcionarioId: f.id };
  }
}

const PODE = ['funcionarios.gerenciar'] as const;

@Controller('rh/desempenho')
export class DesempenhoController {
  constructor(private readonly service: DesempenhoService) {}

  @Get('questionarios') @Requer(...PODE) questionarios(@Usuario() u: UsuarioToken) { return this.service.questionarios(u); }
  @Post('questionarios') @Requer(...PODE) criarModelo(@Usuario() u: UsuarioToken, @Body() dto: ModeloDto) { return this.service.salvarModelo(u, dto); }
  @Put('questionarios/:id') @Requer(...PODE) editarModelo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModeloDto) { return this.service.salvarModelo(u, dto, id); }
  @Post('selecao-modelos') @Requer(...PODE) criarSelecao(@Usuario() u: UsuarioToken, @Body() dto: SelecaoModeloDto) { return this.service.salvarSelecao(u, dto); }
  @Put('selecao-modelos/:id') @Requer(...PODE) editarSelecao(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SelecaoModeloDto) { return this.service.salvarSelecao(u, dto, id); }
  @Delete('questionarios/:id') @Requer(...PODE) removerModelo(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.removerModelo(u, id); }

  @Get('avaliacoes') @Requer(...PODE) avaliacoes(@Usuario() u: UsuarioToken, @Query('periodo') periodo?: string) { return this.service.avaliacoes(u, periodo); }
  @Get('avaliacoes/:id') @Requer(...PODE) avaliacao(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.avaliacao(u, id); }
  @Post('avaliacoes') @Requer(...PODE) avaliar(@Usuario() u: UsuarioToken, @Body() dto: AvaliacaoDto) { return this.service.avaliar(u, dto); }
  @Post('avaliacoes/:id/ciente') @Requer(...PODE) ciente(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.ciente(u, id); }

  @Get('candidatos') @Requer(...PODE) candidatos(@Usuario() u: UsuarioToken) { return this.service.candidatos(u); }
  @Post('candidatos') @Requer(...PODE) criarCandidato(@Usuario() u: UsuarioToken, @Body() dto: CandidatoDto) { return this.service.salvarCandidato(u, dto); }
  @Get('candidatos/:id') @Requer(...PODE) fichaCandidato(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.fichaCandidato(u, id); }
  @Put('candidatos/:id') @Requer(...PODE) editarCandidato(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CandidatoDto) { return this.service.salvarCandidato(u, dto, id); }
  @Put('candidatos/:id/status') @Requer(...PODE) statusCandidato(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusCandidatoDto) { return this.service.statusCandidato(u, id, dto); }
  @Post('candidatos/:id/prova/:modeloId') @Requer(...PODE) gerarProva(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Param('modeloId', ParseUUIDPipe) m: string) { return this.service.gerarProva(u, id, m); }
  @Post('candidatos/:id/entrevista') @Requer(...PODE) entrevistar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EntrevistaDto) { return this.service.entrevistar(u, id, dto); }
  @Post('candidatos/:id/contratar') @Requer(...PODE) contratar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.contratar(u, id); }
}

/** prova do candidato pelo celular (sem login, pelo link) */
@Controller('publico/prova')
export class ProvaPublicaController {
  constructor(private readonly service: DesempenhoService) {}

  @Get(':token') @Publico() ver(@Param('token') token: string) { return this.service.provaPublica(token); }
  @Post(':token') @HttpCode(200) @Publico() responder(@Param('token') token: string, @Body() dto: ProvaRespostasDto) { return this.service.responderProva(token, dto); }
}
