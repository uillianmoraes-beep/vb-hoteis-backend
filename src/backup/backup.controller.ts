import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupAgoraDto, ConfigBackupDto } from './backup.dto';
import { Usuario } from '../common/decorators/usuario.decorator';
import { Requer } from '../common/decorators/requer.decorator';
import { UsuarioToken } from '../common/permissoes';

@Controller('backup')
@Requer('empresa.editar')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Get() painel(@Usuario() u: UsuarioToken) { return this.service.painel(u); }

  @Put('config') config(@Usuario() u: UsuarioToken, @Body() dto: ConfigBackupDto) { return this.service.salvarConfig(u, dto); }

  @Post('agora') @HttpCode(200)
  agora(@Usuario() u: UsuarioToken, @Body() dto: BackupAgoraDto) { return this.service.agora(u, dto.senha); }

  @Get('arquivos/:id/baixar')
  async baixar(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string, @Res() res: any) {
    const a = await this.service.arquivo(u, id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${a.nome}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(a.conteudo);
  }

  @Delete('arquivos/:id') excluir(@Usuario() u: UsuarioToken, @Param('id', ParseUUIDPipe) id: string) { return this.service.excluir(u, id); }

  /** corpo = o arquivo .vbbackup (application/octet-stream) */
  @Post('restaurar') @HttpCode(200)
  restaurar(@Usuario() u: UsuarioToken, @Req() req: { body: unknown }, @Headers('x-senha-backup') senhaBackup?: string,
    @Headers('x-senha-usuario') senhaUsuario?: string, @Headers('x-confirmacao') confirmacao?: string) {
    const dec = (v?: string) => (v ? decodeURIComponent(v) : undefined);
    return this.service.restaurar(u, req.body as Buffer, dec(senhaBackup), dec(senhaUsuario), confirmacao);
  }
}
