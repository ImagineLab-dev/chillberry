import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './common/guards/rbac.module';
import { AppThrottlerModule } from './common/security/throttler.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { BranchesModule } from './modules/branches/branches.module';
import { TablesModule } from './modules/tables/tables.module';
import { MenuModule } from './modules/menu/menu.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { KitchenModule } from './modules/kitchen/kitchen.module';
import { WaitersModule } from './modules/waiters/waiters.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PosModule } from './modules/pos/pos.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { BillingModule } from './modules/billing/billing.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { CustomersModule } from './modules/customers/customers.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { TenantSettingsModule } from './modules/tenant-settings/tenant-settings.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Cron jobs (recordatorios de reserva, reasignación de delivery).
    ScheduleModule.forRoot(),

    // Infraestructura común.
    PrismaModule,
    AppThrottlerModule,
    RbacModule,

    // Módulos de negocio — Fase 0 (fundación).
    AuthModule,
    UsersModule,
    RestaurantsModule,
    BranchesModule,
    TablesModule,
    MenuModule,
    InventoryModule,
    OrdersModule,

    // Fase 1 (cocina / KDS).
    KitchenModule,

    // Fase 2 (meseros).
    WaitersModule,

    // Fase 3 (pagos).
    PaymentsModule,
    InvoicesModule,

    // Fase 4 (caja / POS).
    PosModule,

    // Fase 5 (delivery).
    DeliveryModule,

    // Fase 6 (SaaS billing).
    BillingModule,

    // Panel de admin — uploads de imágenes y KPIs del dashboard.
    UploadsModule,
    DashboardModule,
    ReportsModule,
    ReservationsModule,
    FeedbackModule,
    PurchasingModule,
    MarketingModule,
    CouponsModule,
    CustomersModule,
    LoyaltyModule,
    TenantSettingsModule,

    // Panel interno de Smartia (staff del SaaS, no de un tenant). Único
    // módulo que lee cross-tenant — ver super-admin.service.ts.
    SuperAdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
