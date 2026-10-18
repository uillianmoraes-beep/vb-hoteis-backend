import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { EmpresasService } from './empresas.service';
import { AtualizarEmpresaDto, LogoDto } from './empresas.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('empresa')
export class EmpresasController {
  constructor(private readonly service: EmpresasService) {}

  @Get()
  minha(@Usuario() u: UsuarioToken) {
    return this.service.buscar(u.empresaId);
  }

  @Patch()
  @Requer('empresa.editar')
  atualizar(@Usuario() u: UsuarioToken, @Body() dto: AtualizarEmpresaDto) {
    return this.service.atualizar(u.empresaId, dto);
  }

  /** logotipo para os impressos (qualquer usuário logado lê) */
  @Get('logo')
  logo(@Usuario() u: UsuarioToken) {
    return this.service.logo(u.empresaId);
  }

  @Put('logo')
  @Requer('empresa.editar')
  salvarLogo(@Usuario() u: UsuarioToken, @Body() dto: LogoDto) {
    return this.service.salvarLogo(u.empresaId, dto.logo ?? null);
  }
}
