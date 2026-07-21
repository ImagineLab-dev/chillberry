import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
 * Namespace dedicado `/kitchen` para no mezclar con otros gateways futuros
 * (orders.gateway, delivery.gateway en fases siguientes).
 *
 * Auth: el cliente manda el access token en `socket.handshake.auth.token`
 * (no en query string, para no dejarlo en logs de acceso). Se valida acá
 * mismo con el mismo secret que usa JwtStrategy — no hay Guard de Nest para
 * WS con Socket.IO puro, así que la validación es manual en `handleConnection`.
 */
@WebSocketGateway({
  namespace: '/kitchen',
  cors: { origin: true, credentials: true },
})
export class KitchenGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Con `namespace: '/kitchen'` configurado, Nest inyecta acá el objeto
  // `Namespace`, no el `Server` raíz — `Namespace` trae `.adapter` directo
  // (el `Server` raíz lo anida bajo `.sockets.adapter`). Tipar como `Server`
  // dejaba pasar accesos a props que no existen en runtime — ver `.rooms()`.
  @WebSocketServer() server!: Namespace;

  private readonly logger = new Logger(KitchenGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<JwtAccessPayload>(token, {
        secret: loadEnv().JWT_ACCESS_SECRET,
      });
      client.data.tenantId = payload.tenantId;
      client.data.role = payload.role;
    } catch {
      this.logger.warn(`Conexión WS rechazada (token inválido): ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket) {
    // no-op por ahora — nada que limpiar del lado del servidor
  }

  @SubscribeMessage('kitchen:join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { branchId?: string }) {
    const branchId = body?.branchId;
    const tenantId = client.data.tenantId as string | undefined;
    if (!branchId || !tenantId) return;

    // Confirma que la sucursal pertenece al tenant del socket antes de unirlo
    // a la room — sin esto, cualquier cliente autenticado de OTRO tenant
    // podría suscribirse a eventos de cocina ajenos con solo adivinar un id.
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) return;

    await client.join(this.roomName(branchId));
  }

  /**
   * La CAJA (POS) se une a su propia room por sucursal para recibir avisos
   * operativos del cajero — hoy: `cash:bill-requested` cuando una mesa pide la
   * cuenta. Room separada de la de cocina para no mezclar el tráfico de KDS con
   * el de caja (cada pantalla sólo escucha lo suyo). Misma validación de
   * pertenencia sucursal↔tenant que `kitchen:join`.
   */
  @SubscribeMessage('cash:join')
  async onCashJoin(@ConnectedSocket() client: Socket, @MessageBody() body: { branchId?: string }) {
    const branchId = body?.branchId;
    const tenantId = client.data.tenantId as string | undefined;
    if (!branchId || !tenantId) return;

    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) return;

    await client.join(this.cashRoomName(branchId));
  }

  roomName(branchId: string): string {
    return `branch:${branchId}:kitchen`;
  }

  cashRoomName(branchId: string): string {
    return `branch:${branchId}:cash`;
  }

  emitToBranch(branchId: string, event: string, payload: unknown) {
    this.server.to(this.roomName(branchId)).emit(event, payload);
  }

  emitToCash(branchId: string, event: string, payload: unknown) {
    this.server.to(this.cashRoomName(branchId)).emit(event, payload);
  }
}
