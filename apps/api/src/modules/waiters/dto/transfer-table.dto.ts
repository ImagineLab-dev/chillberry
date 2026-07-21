import { IsUUID } from 'class-validator';

export class TransferTableDto {
  @IsUUID()
  orderId!: string;

  @IsUUID()
  toTableId!: string;
}
