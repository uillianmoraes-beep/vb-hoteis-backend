import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
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

/**
 * Primeira subida: se ainda não existe nenhum usuário, cria a empresa,
 * os perfis padrão, os motivos de bloqueio e o administrador.
 * Com SEED_EXEMPLOS=true, cria também ambientes, categorias e unidades de exemplo.
 * Depois disso não faz mais nada.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly log = new Logger('Seed');

  constructor(private readonly ds: DataSource) {}

  /** Remove o nome da variável se ele tiver sido colado junto do valor (ex.: "SEED_ADMIN_SENHA=abc"). */
  private limpar(nome: string, valor?: string): string | undefined {
    if (!valor) return undefined;
    let v = valor.trim();
    if (v.toUpperCase().startsWith(nome)) v = v.slice(nome.length).replace(/^\s*[=:]\s*/, '');
    return v.replace(/^["']|["']$/g, '').trim() || undefined;
  }

  /**
   * Com REDEFINIR_ADMIN=true, regrava login e senha do Administrador a partir de
   * SEED_ADMIN_LOGIN e SEED_ADMIN_SENHA. Depois de entrar, apague REDEFINIR_ADMIN.
   */
  private async redefinirAdmin(login: string, senha: string) {
    const perfil = await this.ds.getRepository(Perfil).findOne({ where: { sistema: true }, order: { criadoEm: 'ASC' } });
    if (!perfil) return;
    const repo = this.ds.getRepository(UsuarioEntity);
    const admin = await repo.findOne({ where: { perfilId: perfil.id }, order: { criadoEm: 'ASC' } });
    if (!admin) return;
    await repo.update({ id: admin.id }, { login: login.trim(), senhaHash: await bcrypt.hash(senha, 10), ativo: true });
    this.log.warn(`Login e senha do Administrador redefinidos (login: ${login.trim()}). Apague a variável REDEFINIR_ADMIN.`);
  }

  async onApplicationBootstrap() {
    const jaTemUsuario = await this.ds.getRepository(UsuarioEntity).exists();
    if (jaTemUsuario) {
      const loginR = this.limpar('SEED_ADMIN_LOGIN', process.env.SEED_ADMIN_LOGIN);
      const senhaR = this.limpar('SEED_ADMIN_SENHA', process.env.SEED_ADMIN_SENHA);
      if ((this.limpar('REDEFINIR_ADMIN', process.env.REDEFINIR_ADMIN) || '').toLowerCase() === 'true' && loginR && senhaR) {
        await this.redefinirAdmin(loginR, senhaR);
      }
      return;
    }

    const login = this.limpar('SEED_ADMIN_LOGIN', process.env.SEED_ADMIN_LOGIN);
    const senha = this.limpar('SEED_ADMIN_SENHA', process.env.SEED_ADMIN_SENHA);
    if (!login || !senha) {
      this.log.warn('Banco sem usuários. Configure SEED_ADMIN_LOGIN e SEED_ADMIN_SENHA para criar o administrador.');
      return;
    }

    await this.ds.transaction(async (m) => {
      const empresa = await m.save(
        m.create(Empresa, { nome: process.env.SEED_EMPRESA_NOME || 'Estabelecimento Exemplo', vocabulario: {} }),
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

      await m.save(
        m.create(UsuarioEntity, {
          empresaId,
          perfilId: admin.id,
          nome: process.env.SEED_ADMIN_NOME || 'Administrador',
          login: login.trim(),
          senhaHash: await bcrypt.hash(senha, 10),
          ambientesIds: null,
        }),
      );

      if ((process.env.SEED_EXEMPLOS || 'false').toLowerCase() === 'true') {
        const [motel, hotel] = await m.save([
          m.create(Ambiente, {
            empresaId, nome: 'Motel', tipo: 'motel', cor: '#E11D48', ordem: 1,
            regras: { toleranciaMin: 15, aposUltimo: 'hora_adicional', pessoasIncluidas: 2, alertaViradaMin: 10 },
          }),
          m.create(Ambiente, { empresaId, nome: 'Hotel', tipo: 'hotel', cor: '#0E77DA', ordem: 2 }),
        ]);
        const [standard, luxo, hidro, quarto] = await m.save([
          m.create(Categoria, { empresaId, nome: 'Standard', tipoUnidade: 'suite', ordem: 1 }),
          m.create(Categoria, { empresaId, nome: 'Luxo', tipoUnidade: 'suite', ordem: 2 }),
          m.create(Categoria, { empresaId, nome: 'Hidro', tipoUnidade: 'suite', ordem: 3 }),
          m.create(Categoria, { empresaId, nome: 'Quarto Standard', tipoUnidade: 'quarto', ordem: 4 }),
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
        await m.save(m.create(TabelaPreco, { empresaId, ambienteId: motel.id, nome: 'Todos os dias', prioridade: 0 }));
      }
    });

    this.log.log(`Primeira configuração feita. Entre com o login ${login}.`);
  }
}
