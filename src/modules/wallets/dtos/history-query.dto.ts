import {
  IsOptional,
  IsString,
  IsNumberString,
  IsDateString,
  IsEnum,
} from 'class-validator';
import { WalletType } from '../entities/wallet.entity';

export class HistoryQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsEnum(WalletType)
  walletType?: WalletType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
