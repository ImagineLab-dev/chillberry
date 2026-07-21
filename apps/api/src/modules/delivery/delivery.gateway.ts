import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Namespace, Socket } from 'socket.io';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtAccessPayload } from '../auth/auth.types';

/**
 * Namespace `/delivery`. A diferencia de `/kitchen`, acá SÍ se permiten
 * conexiones anónimas — el tracking público (`GET /track/:id` y su
 * contraparte en vivo acá) no tiene JWT porque lo ve el cliente final desde
 * un link compartido, no un usuario logueado del sistema.
 */
@WebSocketGateway({
  namespace: '/delivery',
  cors: { origin: true, credentials: true },
})
export class DeliveryGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  private readonly logger = new Logger(DeliveryGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) return; // anónimo permitido — solo para tracking público

    try {
      const payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: loadEnv().JWT_ACCESS_SECRET,
      });
      client.data.tenantId = payload.tenantId;
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      this.logger.warn(`Token inválido en conexión /delivery (queda como anónimo): ${client.id}`);
    }
  }

  /** El repartidor autenticado se suscribe a los pedidos que le asignan. */
  @SubscribeMessage('driver:join')
  async onDriverJoin(@ConnectedSocket() client: Socket) {
    const tenantId = client.data.tenantId as string | undefined;
    const userId = client.data.userId as string | undefined;
    if (!tenantId || !userId) return;

    const driver = await this.prisma.driver.findFirst({ where: { userId, tenantId } });
    if (!driver) return;

    await client.join(this.driverRoom(driver.id));
  }

  /**
   * El DESPACHADOR (staff en el panel de delivery) se une a la room de su
   * sucursal para enterarse EN VIVO de deliveries nuevos — sobre todo los que
   * quedan sin repartidor y necesitan asignación manual. Requiere estar
   * autenticado y que la sucursal sea de su tenant (mismo criterio que cocina).
   */
  @SubscribeMessage('dispatcher:join')
  async onDispatcherJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { branchId?: string }) {
    const tenantId = client.data.tenantId as string | undefined;
    const branchId = body?.branchId;
    if (!tenantId || !branchId) return;

    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) return;

    await client.join(this.dispatchRoom(branchId));
  }

  /** Cualquiera (autenticado o no) puede seguir un delivery puntual por id
   * — es el mismo modelo de seguridad que un link de tracking compartible. */
  @SubscribeMessage('delivery:track')
  async onTrack(@ConnectedSocket() client: Socket, @MessageBody() body: { deliveryId?: string }) {
    if (!body?.deliveryId) return;
    const delivery = await this.prisma.delivery.findUnique({ where: { id: body.deliveryId } });
    if (!delivery) return;
    await client.join(this.trackingRoom(body.deliveryId));
  }

  driverRoom(driverId: string): string {
    return `driver:${driverId}`;
  }

  trackingRoom(deliveryId: string): string {
    return `delivery:${deliveryId}:tracking`;
  }

  dispatchRoom(branchId: string): string {
    return `dispatch:${branchId}`;
  }

  emitToDriver(driverId: string, event: string, payload: unknown) {
    this.server.to(this.driverRoom(driverId)).emit(event, payload);
  }

  emitToTracking(deliveryId: string, event: string, payload: unknown) {
    this.server.to(this.trackingRoom(deliveryId)).emit(event, payload);
  }

  emitToDispatch(branchId: string, event: string, payload: unknown) {
    this.server.to(this.dispatchRoom(branchId)).emit(event, payload);
  }
}
