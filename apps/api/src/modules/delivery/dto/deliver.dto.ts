import { IsOptional, IsString, IsUrl, Length } from 'class-validator';

export class DeliverDto {
  @IsString()
  @Length(4, 6)
  confirmationCode!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  proofPhotoUrl?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  proofSignatureUrl?: string;
}
