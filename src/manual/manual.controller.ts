import { Body, Controller, Delete, Get, Header, Param, Put, StreamableFile } from '@nestjs/common';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';
import { ManualService } from './manual.service';
import { PrintManualDto } from './manual.dto';

/** Prints do manual de utilização: todos veem; só quem edita a empresa gera ou apaga. */
@Controller('manual')
export class ManualController {
  constructor(private readonly service: ManualService) {}

  @Get('prints')
  listar(@Usuario() u: UsuarioToken) {
    return this.service.listar(u.empresaId);
  }

  @Get('prints/:tela')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'private, no-cache')
  async print(@Usuario() u: UsuarioToken, @Param('tela') tela: string) {
    return new StreamableFile(await this.service.ler(u.empresaId, tela));
  }

  @Put('prints/:tela')
  @Requer('empresa.editar')
  salvar(@Usuario() u: UsuarioToken, @Param('tela') tela: string, @Body() dto: PrintManualDto) {
    return this.service.salvar(u.empresaId, tela, dto);
  }

  @Delete('prints/:tela')
  @Requer('empresa.editar')
  apagar(@Usuario() u: UsuarioToken, @Param('tela') tela: string) {
    return this.service.apagar(u.empresaId, tela);
  }
}
