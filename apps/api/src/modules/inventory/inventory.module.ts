import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  // Exportado para que PaymentsService descuente stock al completar un pedido.
  exports: [InventoryService],
})
export class InventoryModule {}
