import { IsString, IsNumber, IsEnum } from 'class-validator';
import { WalletType } from '../entities/wallet.entity';

export class WalletTransactionDto {
  @IsEnum(WalletType)
  walletType: WalletType;

  @IsString()
  currency: string;

  @IsNumber()
  amount: number;
}
