import { EntityManager } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Empresa } from '../empresas/empresa.entity';
import { Ambiente } from '../ambientes/ambiente.entity';
import { Categoria } from '../categorias/categoria.entity';
import { MotivoBloqueio } from '../motivos-bloqueio/motivo-bloqueio.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Perfil } from '../perfis/perfil.entity';
import { UsuarioEntity } from '../usuarios/usuario.entity';
import { LimitesPerfil, Permissao, PERMISSOES } from '../common/permissoes';
import { Periodo } from '../tarifas/periodo.entity';
import { TabelaPreco } from '../tarifas/tabela-preco.entity';
import { Preco } from '../tarifas/preco.entity';
import { Produto } from '../produtos/produto.entity';

export interface NovaEmpresa {
  nome: string;
  adminNome: string;
  login: string;
  senha: string;
  /** ambientes, categorias, suítes e períodos de exemplo */
  exemplos: boolean;
  /** além dos exemplos, preços e produtos (demonstração / teste grátis) */
  precosExemplo?: boolean;
  /** colunas extras da empresa (situação da revenda, responsável…) */
  extra?: Partial<Empresa> & Record<string, unknown>;
}

/**
 * Cria uma empresa pronta para usar: perfis padrão, motivos de bloqueio e o administrador
 * (e, se pedir, suítes, períodos, preços e produtos de exemplo). Usada na primeira subida e na revenda.
 */
export async function criarEmpresa(m: EntityManager, o: NovaEmpresa): Promise<{ empresaId: string; usuarioId: string }> {
  const empresa = await m.save(
    m.create(Empresa, { nome: o.nome, vocabulario: {}, ...(o.extra ?? {}) }),
  );
  const empresaId = empresa.id;

  const todas = Object.keys(PERMISSOES) as Permissao[];
  const perfisPadrao: { nome: string; descricao: string; permissoes: string[]; limites: LimitesPerfil; sistema?: boolean }[] = [
    { nome: 'Administrador', descricao: 'Acesso total', permissoes: ['*'], sistema: true,
      limites: { descontoPercentual: 100, acrescimoPercentual: 100, cortesia: true, ajusteDiaria: true } },
    { nome: 'Gerente', descricao: 'Gestão do dia a dia', permissoes: todas.filter((p) => p !== 'empresa.editar'),
      limites: { descontoPercentual: 100, acrescimoPercentual: 100, cortesia: true, ajusteDiaria: true } },
    { nome: 'Recepção', descricao: 'Recepção / telefonista',
      permissoes: ['painel.ver', 'unidades.status', 'unidades.bloquear', 'estadias.operar', 'estadias.entrada'],
      limites: { descontoPercentual: 10, acrescimoPercentual: 10, cortesia: false, ajusteDiaria: true } },
    { nome: 'Supervisor da limpeza', descricao: 'Distribui e revisa a limpeza',
      permissoes: ['painel.ver', 'unidades.status', 'unidades.bloquear', 'unidades.desbloquear'],
      limites: {} },
    { nome: 'Portaria', descricao: 'Dá entrada nas suítes e recebe na entrada', permissoes: ['painel.ver', 'estadias.entrada'], limites: {} },
    { nome: 'Saída', descricao: 'Portão de saída: confere o ticket de liberação', permissoes: ['saida.registrar'], limites: {} },
    { nome: 'Governança', descricao: 'Mesário da limpeza: camareiras, vistoria e liberação', permissoes: ['painel.ver', 'unidades.status', 'unidades.bloquear', 'governanca.operar'], limites: {} },
    { nome: 'Revisora', descricao: 'Vistoria e libera as unidades', permissoes: ['painel.ver', 'unidades.status'], limites: {} },
    { nome: 'Camareira', descricao: 'Limpeza das unidades', permissoes: ['painel.ver', 'unidades.status'], limites: {} },
  ];
  const perfis = await m.save(perfisPadrao.map((p) => m.create(Perfil, { ...p, empresaId })));
  const admin = (perfis as Perfil[]).find((p: Perfil) => p.nome === 'Administrador')!;

  await m.save(
    [
      { nome: 'Manutenção', cor: '#111827', abreManutencao: true, ordem: 1 },
      { nome: 'Faxina completa', cor: '#7C3AED', ordem: 2 },
      { nome: 'Falta de enxoval', cor: '#B45309', ordem: 3 },
      { nome: 'Aguardando peça', cor: '#475569', ordem: 4 },
      { nome: 'Uso interno', cor: '#0E77DA', ordem: 5 },
    ].map((x) => m.create(MotivoBloqueio, { ...x, empresaId })),
  );

  const usuario = await m.save(
    m.create(UsuarioEntity, {
      empresaId,
      perfilId: admin.id,
      nome: o.adminNome,
      login: o.login.trim(),
      senhaHash: await bcrypt.hash(o.senha, 10),
      ambientesIds: null,
    }),
  );

  if (o.exemplos) {
    const [motel, hotel] = await m.save([
      m.create(Ambiente, {
        empresaId, nome: 'Motel', tipo: 'motel', cor: '#E11D48', ordem: 1,
        regras: { toleranciaMin: 15, aposUltimo: 'hora_adicional', pessoasIncluidas: 2, alertaViradaMin: 10 },
      }),
      m.create(Ambiente, { empresaId, nome: 'Hotel', tipo: 'hotel', cor: '#0E77DA', ordem: 2 }),
    ]);
    const [standard, luxo, hidro, quarto] = await m.save([
      m.create(Categoria, { empresaId, ambienteId: motel.id, nome: 'Standard', tipoUnidade: 'suite', ordem: 1 }),
      m.create(Categoria, { empresaId, ambienteId: motel.id, nome: 'Luxo', tipoUnidade: 'suite', ordem: 2 }),
      m.create(Categoria, { empresaId, ambienteId: motel.id, nome: 'Hidro', tipoUnidade: 'suite', ordem: 3 }),
      m.create(Categoria, { empresaId, ambienteId: hotel.id, nome: 'Quarto Standard', tipoUnidade: 'quarto', ordem: 4 }),
    ]);

    const suites = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const cat = n <= 6 ? standard : n <= 10 ? luxo : hidro;
      const codigo = String(n).padStart(2, '0');
      return m.create(Unidade, {
        empresaId, ambienteId: motel.id, ambientePadraoId: motel.id, categoriaId: cat.id,
        codigo, tipo: 'suite', garagem: codigo, ordem: n, status: 'livre',
      });
    });
    const quartos = [101, 102, 103, 104].map((n, i) =>
      m.create(Unidade, {
        empresaId, ambienteId: hotel.id, ambientePadraoId: hotel.id, categoriaId: quarto.id,
        codigo: String(n), tipo: 'quarto', andar: '1º', ordem: 100 + i, status: 'livre',
      }),
    );
    await m.save([...suites, ...quartos]);

    // Padrão de cobrança do motel (editável em Tarifas): 4h, 6h, 12h e pernoite, sem preço
    await m.save([
      m.create(Periodo, { empresaId, ambienteId: motel.id, nome: '4 horas', tipo: 'horas', duracaoMin: 240, ordem: 1 }),
      m.create(Periodo, { empresaId, ambienteId: motel.id, nome: '6 horas', tipo: 'horas', duracaoMin: 360, ordem: 2 }),
      m.create(Periodo, { empresaId, ambienteId: motel.id, nome: '12 horas', tipo: 'horas', duracaoMin: 720, ordem: 3 }),
      m.create(Periodo, { empresaId, ambienteId: motel.id, nome: 'Pernoite', tipo: 'pernoite', pernoiteInicio: '22:00', pernoiteFim: '12:00', ordem: 4 }),
    ]);
    const tabela = await m.save(m.create(TabelaPreco, { empresaId, ambienteId: motel.id, nome: 'Todos os dias', prioridade: 0 }));
    if (o.precosExemplo) {
      // demonstração: preços de exemplo por categoria e alguns produtos, para já dar entrada numa suíte
      const periodos = await m.find(Periodo, { where: { empresaId } });
      const base: Record<string, number> = { '4 horas': 70, '6 horas': 90, '12 horas': 130, Pernoite: 160 };
      const fator = new Map([[standard.id, 1], [luxo.id, 1.4], [hidro.id, 1.9]]);
      const precos = [];
      for (const [cat, f] of fator) {
        for (const p of periodos) precos.push(m.create(Preco, { tabelaId: tabela.id, categoriaId: cat, tipo: 'periodo', periodoId: p.id, valor: (Math.round(base[p.nome] * f) || 80).toFixed(2), duracaoMin: p.duracaoMin ?? null }));
        precos.push(m.create(Preco, { tabelaId: tabela.id, categoriaId: cat, tipo: 'hora_adicional', periodoId: null, valor: (Math.round(20 * f)).toFixed(2), duracaoMin: null }));
      }
      await m.save(precos);
      await m.save([
        ['Água mineral 500 ml', 'Bebidas', 6, true], ['Refrigerante lata', 'Bebidas', 8, true], ['Cerveja long neck', 'Bebidas', 14, true],
        ['Energético', 'Bebidas', 18, true], ['Porção de batata frita', 'Porções', 38, false], ['Tábua de frios', 'Porções', 62, false],
        ['Chocolate', 'Conveniência', 9, true], ['Kit higiene', 'Conveniência', 12, true],
      ].map(([nome, grupo, preco, frigobar]) => m.create(Produto, { empresaId, nome: String(nome), grupo: String(grupo), preco: Number(preco).toFixed(2), frigobar: !!frigobar })));
    }
  }
  return { empresaId, usuarioId: usuario.id };
}
