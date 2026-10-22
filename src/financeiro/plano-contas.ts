import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

/**
 * Plano de contas: cada conta pertence a uma linha da DRE / do fluxo de caixa.
 * Despesas e caixa continuam gravando a categoria como texto; aqui ela é ligada a uma conta
 * (pelo mesmo nome ou por uma ligação feita na tela), e assim o histórico também entra.
 */
export const GRUPOS = [
  { id: 'receita', nome: 'Receitas', descricao: 'O que entra pelas vendas: hospedagem, consumo e outras receitas.', tipo: 'entrada' },
  { id: 'deducao', nome: 'Deduções da receita', descricao: 'Impostos sobre a venda, taxas de cartão e Pix, devoluções.', tipo: 'saida' },
  { id: 'custo', nome: 'Custos variáveis', descricao: 'Sobem quando o movimento sobe: lavanderia, limpeza, amenities, frigobar, cozinha.', tipo: 'saida' },
  { id: 'despesa', nome: 'Despesas fixas e operacionais', descricao: 'Todo mês, com ou sem cliente: salários, energia, água, aluguel, sistema.', tipo: 'saida' },
  { id: 'financeiro', nome: 'Resultado financeiro', descricao: 'Juros, multas, tarifas bancárias e rendimentos.', tipo: 'ambos' },
  { id: 'investimento', nome: 'Investimentos', descricao: 'Compra de equipamentos e reformas (não é despesa do mês: entra no fluxo de caixa).', tipo: 'saida' },
  { id: 'financiamento', nome: 'Empréstimos e financiamentos', descricao: 'Dinheiro emprestado que entra e as parcelas que saem.', tipo: 'ambos' },
  { id: 'socios', nome: 'Sócios', descricao: 'Retirada de lucro e aporte dos sócios.', tipo: 'ambos' },
  { id: 'transferencia', nome: 'Transferências (não entram no resultado)', descricao: 'Sangria, reforço de troco e passagem de dinheiro entre caixas e contas.', tipo: 'ambos' },
] as const;
type Grupo = (typeof GRUPOS)[number]['id'];
const IDS_GRUPO = GRUPOS.map((g) => g.id) as string[];

/** modelo pronto para hotel e motel */
const MODELO: [Grupo, string[]][] = [
  ['receita', ['Hospedagem e locação', 'Consumo (frigobar, bar e cozinha)', 'Outras receitas', 'Venda de sucata e ativos']],
  ['deducao', ['Impostos sobre vendas', 'Taxas de cartão e Pix', 'Devoluções e cancelamentos']],
  ['custo', ['Fornecedores (mercadorias)', 'Reposição de frigobar e bebidas', 'Insumos da cozinha', 'Lavanderia', 'Produtos de limpeza', 'Amenities e higiene', 'Enxoval', 'Comissões']],
  ['despesa', ['Salários e encargos', 'Vale-transporte e alimentação', 'Uniformes e EPIs', 'Energia elétrica', 'Água e esgoto', 'Gás', 'Internet e telefone',
    'Aluguel e IPTU', 'Manutenção e reparos', 'Sistema e software', 'Marketing e anúncios', 'Contabilidade', 'Material de escritório', 'Outras despesas']],
  ['financeiro', ['Juros e multas pagos', 'Tarifas bancárias', 'Rendimentos de aplicações']],
  ['investimento', ['Compra de equipamentos', 'Reformas e obras']],
  ['financiamento', ['Empréstimo recebido', 'Parcelas de empréstimos']],
  ['socios', ['Retirada dos sócios', 'Aporte dos sócios']],
  ['transferencia', ['Sangria e reforço de troco', 'Transferência entre contas']],
];

/** categorias que o sistema já usa (texto) e a conta do modelo onde elas entram */
const LIGACOES_PADRAO: Record<string, string> = {
  'pagamento de fornecedor': 'Fornecedores (mercadorias)', fornecedores: 'Fornecedores (mercadorias)', 'contas a pagar': 'Outras despesas',
  passagem: 'Vale-transporte e alimentação', padaria: 'Insumos da cozinha', 'outras despesas': 'Outras despesas',
  'reforço de troco': 'Sangria e reforço de troco', 'outras entradas': 'Outras receitas', 'devolução ao cliente': 'Devoluções e cancelamentos',
  energia: 'Energia elétrica', 'água': 'Água e esgoto', agua: 'Água e esgoto', aluguel: 'Aluguel e IPTU', 'salários': 'Salários e encargos', salarios: 'Salários e encargos',
  internet: 'Internet e telefone', telefone: 'Internet e telefone', manutenção: 'Manutenção e reparos', manutencao: 'Manutenção e reparos', impostos: 'Impostos sobre vendas',
};

class ContaDto {
  @IsIn(IDS_GRUPO) grupo!: Grupo;
  @IsString() @MinLength(2) @MaxLength(60) nome!: string;
}
class AtualizarContaDto {
  @IsOptional() @IsIn(IDS_GRUPO) grupo?: Grupo;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) nome?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}
class LigarCategoriaDto {
  @IsString() @MinLength(1) @MaxLength(60) categoria!: string;
  /** null = desfaz a ligação */
  @ValidateIf((o) => o.contaId !== null) @IsUUID() contaId!: string | null;
}

@Injectable()
export class PlanoContasService {
  constructor(private readonly ds: DataSource) {}

  /** primeira vez: cria o modelo pronto e liga as categorias conhecidas */
  async garantirModelo(empresaId: string, m: EntityManager | DataSource = this.ds) {
    const [tem] = await m.query(`SELECT 1 FROM plano_contas WHERE empresa_id = $1 LIMIT 1`, [empresaId]);
    if (tem) return;
    let ordem = 0;
    for (const [grupo, nomes] of MODELO) {
      for (const nome of nomes) {
        await m.query(`INSERT INTO plano_contas (empresa_id, grupo, nome, ordem) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [empresaId, grupo, nome, ordem++]);
      }
    }
    for (const [categoria, conta] of Object.entries(LIGACOES_PADRAO)) {
      await m.query(
        `INSERT INTO plano_contas_categorias (empresa_id, categoria, conta_id)
         SELECT $1, $2, id FROM plano_contas WHERE empresa_id = $1 AND lower(nome) = lower($3) ON CONFLICT DO NOTHING`, [empresaId, categoria, conta]);
    }
  }

  /** conta de cada categoria de texto: ligação feita na tela, senão uma conta com o mesmo nome */
  async contaDasCategorias(empresaId: string): Promise<Map<string, string>> {
    const l: { categoria: string; conta_id: string }[] = await this.ds.query(
      `SELECT lower(c.nome) AS categoria, c.id AS conta_id FROM plano_contas c WHERE c.empresa_id = $1
       UNION ALL SELECT lower(categoria), conta_id FROM plano_contas_categorias WHERE empresa_id = $1`, [empresaId]);
    return new Map(l.map((x) => [x.categoria, x.conta_id]));
  }

  async ver(u: UsuarioToken) {
    await this.garantirModelo(u.empresaId);
    const contas = await this.ds.query(`SELECT id, grupo, nome, ordem, ativo FROM plano_contas WHERE empresa_id = $1 ORDER BY ordem, nome`, [u.empresaId]);
    // categorias de texto já usadas (despesas, caixa principal e ADM) e as dos botões do caixa
    const usadas: { categoria: string; usos: number; total: string }[] = await this.ds.query(
      `SELECT categoria, sum(usos)::int AS usos, sum(total) AS total FROM (
         SELECT categoria, count(*) AS usos, sum(valor) AS total FROM contas_pagar WHERE empresa_id = $1 AND status <> 'cancelada' AND categoria IS NOT NULL GROUP BY categoria
         UNION ALL
         SELECT categoria, count(*), sum(valor) FROM caixa_movimentos WHERE empresa_id = $1 AND categoria IS NOT NULL GROUP BY categoria) x
       GROUP BY categoria ORDER BY 2 DESC`, [u.empresaId]);
    const [emp] = await this.ds.query(`SELECT config_caixa FROM empresas WHERE id = $1`, [u.empresaId]);
    const doCaixa: string[] = [...(emp?.config_caixa?.saidas ?? ['Pagamento de fornecedor', 'Passagem', 'Padaria', 'Outras despesas']),
      ...(emp?.config_caixa?.entradas ?? ['Reforço de troco', 'Outras entradas'])];
    const ligadas: { categoria: string; conta_id: string }[] = await this.ds.query(`SELECT categoria, conta_id FROM plano_contas_categorias WHERE empresa_id = $1`, [u.empresaId]);
    const porNome = new Map(contas.map((c: { id: string; nome: string }) => [c.nome.toLowerCase(), c.id]));
    const ligacao = new Map(ligadas.map((l) => [l.categoria.toLowerCase(), l.conta_id]));
    const vistas = new Map<string, { categoria: string; usos: number; total: number }>();
    for (const x of usadas) vistas.set(x.categoria.toLowerCase(), { categoria: x.categoria, usos: Number(x.usos), total: Number(x.total) });
    for (const c of doCaixa) if (!vistas.has(c.toLowerCase())) vistas.set(c.toLowerCase(), { categoria: c, usos: 0, total: 0 });
    const categorias = [...vistas.entries()]
      .filter(([k]) => !porNome.has(k) || ligacao.has(k))
      .map(([k, v]) => ({ ...v, contaId: ligacao.get(k) ?? null }));
    return {
      grupos: GRUPOS,
      contas: contas.map((c: Record<string, unknown>) => ({ id: c.id, grupo: c.grupo, nome: c.nome, ativo: c.ativo })),
      categorias,
    };
  }

  /** contas ativas para escolher (despesas, caixa) */
  async lista(u: UsuarioToken) {
    await this.garantirModelo(u.empresaId);
    return this.ds.query(`SELECT id, grupo, nome FROM plano_contas WHERE empresa_id = $1 AND ativo ORDER BY ordem, nome`, [u.empresaId]);
  }

  async criar(u: UsuarioToken, dto: ContaDto) {
    await this.garantirModelo(u.empresaId);
    const nome = dto.nome.trim();
    const [ja] = await this.ds.query(`SELECT id FROM plano_contas WHERE empresa_id = $1 AND lower(nome) = lower($2)`, [u.empresaId, nome]);
    if (ja) throw new BadRequestException(`Já existe a conta "${nome}".`);
    const [o] = await this.ds.query(`SELECT COALESCE(max(ordem), 0) + 1 AS n FROM plano_contas WHERE empresa_id = $1 AND grupo = $2`, [u.empresaId, dto.grupo]);
    const [c] = await this.ds.query(`INSERT INTO plano_contas (empresa_id, grupo, nome, ordem) VALUES ($1,$2,$3,$4) RETURNING id`, [u.empresaId, dto.grupo, nome, o.n]);
    return { ok: true, id: c.id };
  }

  async atualizar(u: UsuarioToken, id: string, dto: AtualizarContaDto) {
    const [c] = await this.ds.query(`SELECT * FROM plano_contas WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Conta não encontrada.');
    const nome = dto.nome?.trim();
    if (nome && nome.toLowerCase() !== String(c.nome).toLowerCase()) {
      const [ja] = await this.ds.query(`SELECT id FROM plano_contas WHERE empresa_id = $1 AND lower(nome) = lower($2) AND id <> $3`, [u.empresaId, nome, id]);
      if (ja) throw new BadRequestException(`Já existe a conta "${nome}".`);
    }
    await this.ds.transaction(async (m) => {
      // renomeou: o nome antigo continua ligado (lançamentos antigos gravaram o nome antigo)
      if (nome && nome !== c.nome) {
        await m.query(`INSERT INTO plano_contas_categorias (empresa_id, categoria, conta_id) VALUES ($1,$2,$3) ON CONFLICT (empresa_id, categoria) DO UPDATE SET conta_id = $3`,
          [u.empresaId, c.nome, id]);
      }
      await m.query(`UPDATE plano_contas SET nome = COALESCE($3, nome), grupo = COALESCE($4, grupo), ativo = COALESCE($5, ativo) WHERE id = $1 AND empresa_id = $2`,
        [id, u.empresaId, nome ?? null, dto.grupo ?? null, dto.ativo ?? null]);
    });
    return { ok: true };
  }

  async ligar(u: UsuarioToken, dto: LigarCategoriaDto) {
    const categoria = dto.categoria.trim();
    if (dto.contaId === null) {
      await this.ds.query(`DELETE FROM plano_contas_categorias WHERE empresa_id = $1 AND lower(categoria) = lower($2)`, [u.empresaId, categoria]);
      return { ok: true };
    }
    const [c] = await this.ds.query(`SELECT id FROM plano_contas WHERE id = $1 AND empresa_id = $2`, [dto.contaId, u.empresaId]);
    if (!c) throw new NotFoundException('Conta não encontrada.');
    await this.ds.query(`DELETE FROM plano_contas_categorias WHERE empresa_id = $1 AND lower(categoria) = lower($2)`, [u.empresaId, categoria]);
    await this.ds.query(`INSERT INTO plano_contas_categorias (empresa_id, categoria, conta_id) VALUES ($1,$2,$3)`, [u.empresaId, categoria, dto.contaId]);
    return { ok: true };
  }
}

@Controller('plano-contas')
export class PlanoContasController {
  constructor(private readonly service: PlanoContasService) {}

  @Get()
  @Requer('despesas.gerenciar', 'caixa.adm', 'relatorios.ver')
  ver(@Usuario() u: UsuarioToken) {
    return this.service.ver(u);
  }

  @Get('lista')
  @Requer('despesas.gerenciar', 'caixa.adm', 'caixa.principal', 'relatorios.ver')
  lista(@Usuario() u: UsuarioToken) {
    return this.service.lista(u);
  }

  @Post()
  @Requer('despesas.gerenciar')
  criar(@Usuario() u: UsuarioToken, @Body() dto: ContaDto) {
    return this.service.criar(u, dto);
  }

  @Post('categorias')
  @HttpCode(200)
  @Requer('despesas.gerenciar')
  ligar(@Usuario() u: UsuarioToken, @Body() dto: LigarCategoriaDto) {
    return this.service.ligar(u, dto);
  }

  @Patch(':id')
  @Requer('despesas.gerenciar')
  atualizar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarContaDto) {
    return this.service.atualizar(u, id, dto);
  }
}
