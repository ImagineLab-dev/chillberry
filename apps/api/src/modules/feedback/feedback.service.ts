import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';

/**
 * Encuesta de calificación post-visita. Dos superficies:
 *  - PÚBLICA (sin auth): el cliente abre `/encuesta/:token`, ve el nombre del
 *    local y responde estrellas + comentario. Usa `PrismaService` crudo — no
 *    hay tenant en el ALS en una request pública; el `token` (único global) es
 *    la credencial, mismo modelo que el tracking de delivery.
 *  - DUEÑO (auth): resultados agregados (promedio, distribución, por mozo,
 *    comentarios), vía el cliente scopeado por tenant.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /** Datos para pintar la pantalla pública de la encuesta. */
  async getByToken(token: string) {
    const fb = await this.prisma.feedback.findUnique({
      where: { token },
      include: { branch: { include: { restaurant: { include: { tenant: true } } } } },
    });
    if (!fb) throw new NotFoundException('Encuesta no encontrada');
    return {
      restaurantName: fb.branch.restaurant.name,
      branchName: fb.branch.name,
      brandColor: fb.branch.restaurant.tenant.brandColor,
      // Si ya respondió, la UI muestra el agradecimiento en vez del formulario.
      completed: fb.completedAt !== null,
      rating: fb.rating,
      comment: fb.comment,
    };
  }

  /** El cliente envía su calificación. Una sola vez por token. */
  async submit(token: string, dto: SubmitFeedbackDto) {
    const fb = await this.prisma.feedback.findUnique({ where: { token } });
    if (!fb) throw new NotFoundException('Encuesta no encontrada');
    if (fb.completedAt) {
      throw new ConflictException('Ya recibimos tu opinión — ¡gracias!');
    }
    await this.prisma.feedback.update({
      where: { token },
      data: {
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
        completedAt: new Date(),
      },
    });
    return { ok: true };
  }

  /**
   * Resultados para el dueño: promedio, distribución 1-5, comentarios recientes
   * y desglose por mozo. Sólo cuenta las encuestas RESPONDIDAS (completedAt).
   */
  async results(branchId?: string, from?: string, to?: string) {
    const range: { gte?: Date; lte?: Date } = {};
    if (from) range.gte = new Date(from);
    if (to) range.lte = new Date(to);

    const done = await this.tenantPrisma.client.feedback.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        // Sólo respondidas; con rango, además dentro de [from, to].
        completedAt: from || to ? { not: null, ...range } : { not: null },
      },
      select: { rating: true, comment: true, waiterId: true, completedAt: true, branchId: true },
      orderBy: { completedAt: 'desc' },
    });

    const count = done.length;
    const ratings = done.map((d) => d.rating ?? 0);
    const average = count > 0 ? Math.round((ratings.reduce((s, r) => s + r, 0) / count) * 100) / 100 : null;
    const distribution = [1, 2, 3, 4, 5].map((star) => ({
      star,
      count: done.filter((d) => d.rating === star).length,
    }));

    // Comentarios recientes (con texto), ya vienen ordenados por completedAt desc.
    const comments = done
      .filter((d) => d.comment)
      .slice(0, 30)
      .map((d) => ({ rating: d.rating, comment: d.comment, at: d.completedAt }));

    // Calificación por mozo: promedio + cantidad. `null` = self-service (QR).
    const byWaiterAgg = new Map<string | null, { sum: number; count: number }>();
    for (const d of done) {
      const key = d.waiterId ?? null;
      const row = byWaiterAgg.get(key) ?? { sum: 0, count: 0 };
      row.sum += d.rating ?? 0;
      row.count += 1;
      byWaiterAgg.set(key, row);
    }
    const waiterIds = [...byWaiterAgg.keys()].filter((k): k is string => k !== null);
    const users =
      waiterIds.length > 0
        ? await this.tenantPrisma.client.user.findMany({
            where: { id: { in: waiterIds } },
            select: { id: true, name: true },
          })
        : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const byWaiter = [...byWaiterAgg.entries()]
      .map(([waiterId, v]) => ({
        waiterId,
        waiterName: waiterId ? (nameById.get(waiterId) ?? 'Mozo eliminado') : 'Sin asignar (QR)',
        average: Math.round((v.sum / v.count) * 100) / 100,
        count: v.count,
      }))
      .sort((a, b) => b.average - a.average);

    // Pendientes: enviadas pero sin responder (tasa de respuesta).
    const pending = await this.tenantPrisma.client.feedback.count({
      where: { ...(branchId ? { branchId } : {}), sentAt: { not: null }, completedAt: null },
    });

    return { average, count, pending, distribution, byWaiter, comments };
  }
}
