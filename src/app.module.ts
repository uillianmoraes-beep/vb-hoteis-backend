import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { opcoesBanco } from './database/typeorm.config';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissoesGuard } from './common/guards/permissoes.guard';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { EmpresasModule } from './empresas/empresas.module';
import { AmbientesModule } from './ambientes/ambientes.module';
import { CategoriasModule } from './categorias/categorias.module';
import { MotivosBloqueioModule } from './motivos-bloqueio/motivos-bloqueio.module';
import { UnidadesModule } from './unidades/unidades.module';
import { PerfisModule } from './perfis/perfis.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { PainelModule } from './painel/painel.module';
import { TarifasModule } from './tarifas/tarifas.module';
import { EstadiasModule } from './estadias/estadias.module';
import { ProdutosModule } from './produtos/produtos.module';
import { SeedModule } from './seed/seed.module';
import { LicencaModule } from './licenca/licenca.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { AvaliacoesModule } from './avaliacoes/avaliacoes.module';
import { RelatoriosModule } from './relatorios/relatorios.module';
import { CortesiasModule } from './cortesias/cortesias.module';
import { FuncionariosModule } from './funcionarios/funcionarios.module';
import { BalcaoModule } from './balcao/balcao.module';
import { DespesasModule } from './despesas/despesas.module';
import { FichasModule } from './fichas/fichas.module';
import { ReservasModule } from './reservas/reservas.module';
import { FaturamentoModule } from './faturamento/faturamento.module';
import { CafeModule } from './cafe/cafe.module';
import { PedidosModule } from './pedidos/pedidos.module';
import { SugestoesModule } from './sugestoes/sugestoes.module';
import { EnxovalModule } from './enxoval/enxoval.module';
import { EstoqueModule } from './estoque/estoque.module';
import { ComprasModule } from './compras/compras.module';
import { CobrancaModule } from './cobranca/cobranca.module';
import { BackupModule } from './backup/backup.module';
import { ManutencaoModule } from './manutencao/manutencao.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ useFactory: () => opcoesBanco() }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        if (!process.env.JWT_SECRET) {
          throw new Error('Variável JWT_SECRET não configurada.');
        }
        return {
          secret: process.env.JWT_SECRET,
          signOptions: { expiresIn: process.env.JWT_EXPIRA_EM || '12h' },
        };
      },
    }),
    HealthModule,
    AuthModule,
    EmpresasModule,
    AmbientesModule,
    CategoriasModule,
    MotivosBloqueioModule,
    UnidadesModule,
    PerfisModule,
    UsuariosModule,
    PainelModule,
    TarifasModule,
    EstadiasModule,
    ProdutosModule,
    SeedModule,
    LicencaModule,
    FiscalModule,
    AvaliacoesModule,
    RelatoriosModule,
    CortesiasModule,
    FuncionariosModule,
    BalcaoModule,
    DespesasModule,
    FichasModule,
    ReservasModule,
    FaturamentoModule,
    CafeModule,
    PedidosModule,
    SugestoesModule,
    EnxovalModule,
    EstoqueModule,
    ComprasModule,
    CobrancaModule,
    BackupModule,
    ManutencaoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissoesGuard },
  ],
})
export class AppModule {}
