import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW'] as const;
type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export class CreateReservationDto {
  @IsUUID()
  branchId!: string;

  /** Mesa puntual. Opcional: se puede reservar sin asignar mesa todavía. */
  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsString()
  @Length(2, 120)
  customerName!: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  customerPhone?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  partySize!: number;

  /** ISO datetime de la reserva. */
  @IsDateString()
  reservedFor!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;
}

export class UpdateReservationDto {
  @IsOptional()
  @IsEnum(RESERVATION_STATUSES)
  status?: ReservationStatus;

  @IsOptional()
  @IsUUID()
  tableId?: string;

  @IsOptional()
  @IsDateString()
  reservedFor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  partySize?: number;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;
}
