import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { loadEnv } from '../../config/env';
import { UPLOADS_DIR } from './uploads.constants';

// La extensión guardada se deriva del MIME VALIDADO, no del nombre del cliente.
// Antes se usaba `extname(file.originalname)`: subiendo `x.html` con
// `Content-Type: image/png` (el filtro solo mira el mimetype) quedaba un
// `<uuid>.html` servido como text/html desde el origen del API → stored XSS.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_EXT));
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Almacenamiento local en disco (MVP) — sirve para un único servidor/VPS.
 * Si en el futuro se necesita escalar horizontalmente, este es el punto de
 * reemplazo por un adapter de storage (S3/R2), mismo patrón que
 * PaymentProviderAdapter/WhatsAppAdapter: cambiar la implementación acá
 * adentro sin tocar los callers (que solo esperan `{ url: string }`).
 */
@Controller('uploads')
export class UploadsController {
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => {
          // El fileFilter ya rechazó cualquier MIME fuera del allowlist, así que
          // acá el mimetype siempre mapea; el fallback es defensa por las dudas.
          cb(null, `${randomUUID()}${MIME_EXT[file.mimetype] ?? '.bin'}`);
        },
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          cb(new BadRequestException('Solo se aceptan imágenes JPG, PNG o WEBP'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const env = loadEnv();
    return { url: `${env.API_BASE_URL}/uploads/${file.filename}` };
  }
}
