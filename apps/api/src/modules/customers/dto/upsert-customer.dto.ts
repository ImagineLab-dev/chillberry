import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

/** Alta/edición manual de un cliente (upsert por teléfono). */
export class UpsertCustomerDto {
  @IsString()
  @Length(6, 30)
  phone!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
