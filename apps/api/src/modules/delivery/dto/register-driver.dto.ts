import { IsEmail, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { VEHICLE_TYPE, type VehicleType } from '@chillberry/domain';
import { IsStrongPassword } from '../../../common/validators/strong-password.decorator';

export class RegisterDriverDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  email!: string;

  @IsStrongPassword()
  password!: string;

  @IsString()
  @Length(6, 30)
  phone!: string;

  @IsEnum(VEHICLE_TYPE)
  vehicleType!: VehicleType;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  licensePlate?: string;
}
