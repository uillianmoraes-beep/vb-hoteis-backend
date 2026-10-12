import { SetMetadata } from '@nestjs/common';
import { Permissao } from '../permissoes';

export const PERMISSOES_EXIGIDAS = 'permissoesExigidas';
/** Exige ao menos uma das permissões informadas. */
export const Requer = (...permissoes: Permissao[]) => SetMetadata(PERMISSOES_EXIGIDAS, permissoes);
