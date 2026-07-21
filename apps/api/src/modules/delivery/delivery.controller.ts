import { BranchScope } from '../../common/decorators/branch-scope.decorator';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DeliveryService, stripConfirmationCode } from './delivery.service';
import { DriversService } from './drivers.service';
import { ZonesService } from './zones.service';
import { RequestDeliveryDto } from './dto/request-delivery.dto';
import { DeliverDto } from './dto/deliver.dto';
import { CancelDeliveryDto } from './dto/cancel-delivery.dto';
import { LocationPingDto } from './dto/location-ping.dto';
import { ReportIncidentDto } from './dto/report-incident.dto';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpdateZoneDto } from './dto/update-zone.dto';
import { SetDriverActiveDto } from './dto/set-driver-active.dto';

const STAFF_ROLES = [USER_ROLE.Owner, USER_ROLE.Admin] as const;

@Controller('delivery')
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly drivers: DriversService,
    private readonly zones: ZonesService,
  ) {}

  // --------------------------------------------------------------- zonas

  @Roles(...STAFF_ROLES)
  @Post('zones')
  createZone(@Body() dto: CreateZoneDto) {
    return this.zones.create(dto);
  }

  @Roles(...STAFF_ROLES, USER_ROLE.Waiter, USER_ROLE.Cashier)
  @Get('zones')
  listZones(@BranchScope() branchId: string) {
    return this.zones.list(branchId);
  }

  @Roles(...STAFF_ROLES)
  @Patch('zones/:id')
  updateZone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto) {
    return this.zones.update(id, dto);
  }

  // Quitar = soft-delete (active:false); preserva el zoneId de pedidos viejos.
  @Roles(...STAFF_ROLES)
  @Delete('zones/:id')
  removeZone(@Param('id', ParseUUIDPipe) id: string) {
    return this.zones.remove(id);
  }

  // ------------------------------------------------------------ drivers

  @Roles(...STAFF_ROLES)
  @Post('drivers')
  registerDriver(@Body() dto: RegisterDriverDto) {
    return this.drivers.register(dto);
  }

  @Roles(...STAFF_ROLES)
  @Get('drivers')
  listDrivers() {
    return this.drivers.list();
  }

  @Roles(...STAFF_ROLES)
  @Get('drivers/map')
  liveMap() {
    return this.drivers.liveMap();
  }

  // Liquidación por repartidor (entregas completadas + tarifas + rating) en el
  // rango. Es lo que el dueño mira para pagar/evaluar. Declarado antes de
  // `drivers/:id/...` no hace falta (no colisiona con `drivers/earnings`).
  @Roles(...STAFF_ROLES)
  @Get('drivers/earnings')
  driverEarnings(@Query('from') from?: string, @Query('to') to?: string) {
    return this.delivery.driverEarnings(from, to);
  }

  // Baja/reactivación del repartidor desde el admin (desactiva su cuenta y lo
  // pone OFFLINE). No borra: sus entregas históricas lo referencian.
  @Roles(...STAFF_ROLES)
  @Patch('drivers/:id/active')
  setDriverActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDriverActiveDto) {
    return this.drivers.setActive(id, dto.active);
  }

  @Roles(USER_ROLE.Driver)
  @Patch('drivers/me/availability')
  updateAvailability(@Body() dto: UpdateAvailabilityDto, @CurrentUser() user: AuthenticatedUser) {
    return this.drivers.updateAvailability(user.id, dto);
  }

  @Roles(USER_ROLE.Driver)
  @Get('drivers/me')
  myProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.getByUserId(user.id);
  }

  // -------------------------------------------------------------- pedidos

  @Roles(...STAFF_ROLES, USER_ROLE.Waiter, USER_ROLE.Cashier)
  @Post('orders/:orderId/request')
  request(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() dto: RequestDeliveryDto) {
    return this.delivery.requestDelivery(orderId, dto);
  }

  @Roles(...STAFF_ROLES)
  @Post('assign/:deliveryId')
  manualAssign(@Param('deliveryId', ParseUUIDPipe) deliveryId: string, @Body('driverId') driverId: string) {
    return this.delivery.manualAssign(deliveryId, driverId);
  }

  // ------------------------------------------------------- flujo del driver

  @Roles(USER_ROLE.Driver)
  @Get('orders/available')
  listAvailable(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.listAvailableForDriver(user.id);
  }

  @Roles(USER_ROLE.Driver)
  @Post(':id/accept')
  accept(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.delivery.accept(id, user.id);
  }

  @Roles(USER_ROLE.Driver)
  @Post(':id/pick-up')
  pickUp(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.delivery.pickUp(id, user.id);
  }

  @Roles(USER_ROLE.Driver)
  @Post(':id/deliver')
  deliver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.delivery.deliver(id, user.id, dto);
  }

  @Roles(USER_ROLE.Driver)
  @Post('location')
  recordLocation(@Body() dto: LocationPingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.delivery.recordLocation(user.id, dto);
  }

  @Roles(USER_ROLE.Driver)
  @Get('history')
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.delivery.history(user.id);
  }

  @Roles(USER_ROLE.Driver, ...STAFF_ROLES)
  @Patch(':id/status')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDeliveryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.delivery.assertCanActOnDelivery(id, user);
    const cancelled = await this.delivery.cancel(id, dto, user.id);
    return hideCodeFromDriver(cancelled, user);
  }

  @Roles(USER_ROLE.Driver, ...STAFF_ROLES)
  @Post(':id/incidents')
  async reportIncident(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportIncidentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.delivery.assertCanActOnDelivery(id, user);
    return this.delivery.reportIncident(id, dto, user.id);
  }

  // Consola de despacho del owner: lista de deliveries de la sucursal.
  @Roles(...STAFF_ROLES)
  @Get()
  list(@BranchScope() branchId: string, @Query('status') status?: string) {
    return this.delivery.listForBranch(branchId, status);
  }

  @Roles(USER_ROLE.Driver, ...STAFF_ROLES)
  @Get(':id')
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.delivery.assertCanActOnDelivery(id, user);
    return hideCodeFromDriver(await this.delivery.getOrThrow(id), user);
  }
}

/**
 * Estas dos rutas las comparten el repartidor y el staff. El staff SÍ puede ver
 * el código de confirmación (lo necesita para dárselo al cliente por teléfono);
 * el repartidor no, porque es justamente el secreto que tiene que pedirle al
 * cliente para poder cerrar la entrega.
 */
function hideCodeFromDriver<T extends object>(delivery: T, user: AuthenticatedUser) {
  return user.role === USER_ROLE.Driver ? stripConfirmationCode(delivery) : delivery;
}
