import { IsString, Length } from 'class-validator';

/** Fusiona el cliente `aliasPhone` dentro de `canonicalPhone`. */
export class MergeCustomersDto {
  @IsString()
  @Length(6, 30)
  canonicalPhone!: string;

  @IsString()
  @Length(6, 30)
  aliasPhone!: string;
}
