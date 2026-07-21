import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como público (sin JWT). Usar con extrema cautela —
 * solo para health, register/login, tracking público, webhooks con firma propia.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
