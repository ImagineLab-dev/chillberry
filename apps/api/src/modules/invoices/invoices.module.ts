import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { DefaultFiscalAdapter } from './adapters/default-fiscal.adapter';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, DefaultFiscalAdapter],
  exports: [InvoicesService],
})
export class InvoicesModule {}
