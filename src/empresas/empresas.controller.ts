import { Body, Controller, Get, Patch } from '@nestjs/common';
import { EmpresasService } from './empresas.service';
import { AtualizarEmpresaDto } from './empresas.dto';
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
}
