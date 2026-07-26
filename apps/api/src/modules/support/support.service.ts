import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailAdapter } from '../integrations/mail/mail.adapter';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';

/** Dirección interna donde caen los reportes/sugerencias de los restaurantes. */
const SUPPORT_INBOX = 'soporte@chillberry.app';

/**
 * Reportes de problema y sugerencias de función que los restaurantes (tenants)
 * le mandan al equipo de Chillberry. Se guardan (para el panel de super-admin)
 * y se avisan por mail a soporte@. Distinto de `FeedbackService` (opiniones de
 * los comensales sobre el restaurante).
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailAdapter,
  ) {}

  async create(dto: CreateSupportRequestDto, user: AuthenticatedUser) {
    const request = await this.prisma.supportRequest.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        type: dto.type,
        message: dto.message,
        context: dto.context ?? null,
      },
    });

    // El aviso por mail va en segundo plano: el reporte YA quedó guardado, así
    // que un fallo del SMTP no le tiene que devolver un error al restaurante
    // (perdería su mensaje). Si falla, queda en el log y el super-admin lo ve
    // igual en el panel.
    this.notify(request.id, user).catch((err) =>
      this.logger.error({ err, requestId: request.id }, 'No se pudo avisar por mail el reporte de soporte'),
    );

    return { ok: true };
  }

  private async notify(requestId: string, user: AuthenticatedUser): Promise<void> {
    const request = await this.prisma.supportRequest.findUnique({
      where: { id: requestId },
      include: { tenant: { select: { name: true } } },
    });
    if (!request) return;

    const tipo = request.type === 'BUG' ? 'Problema reportado' : 'Sugerencia';
    const restaurante = request.tenant?.name ?? 'un restaurante';
    const subject = `[Chillberry] ${tipo} — ${restaurante}`;
    const text = [
      `Tipo: ${tipo}`,
      `Restaurante: ${restaurante} (tenant ${request.tenantId})`,
      `De: ${user.email ?? user.id}`,
      `Pantalla: ${request.context ?? '—'}`,
      '',
      'Mensaje:',
      request.message,
      '',
      '— Enviado automáticamente desde Chillberry',
    ].join('\n');

    await this.mail.send({ to: SUPPORT_INBOX, subject, text });
  }

  /** Listado para el panel de super-admin: sin atender primero, más recientes arriba. */
  listForSuperAdmin() {
    return this.prisma.supportRequest.findMany({
      orderBy: [{ handled: 'asc' }, { createdAt: 'desc' }],
      take: 300,
      include: { tenant: { select: { name: true, slug: true } } },
    });
  }

  async setHandled(id: string, handled: boolean) {
    await this.prisma.supportRequest.update({ where: { id }, data: { handled } });
    return { ok: true };
  }
}
