import { IsIn, IsString, Length } from 'class-validator';

export class SendCampaignDto {
  @IsIn(['frequent', 'inactive', 'new'])
  segment!: 'frequent' | 'inactive' | 'new';

  @IsString()
  @Length(3, 1000)
  message!: string;
}
