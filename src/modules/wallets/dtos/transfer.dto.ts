import { IsString, IsNumber, IsEnum } from 'class-validator';
import { WalletType } from '../entities/wallet.entity';

export class TransferDto {
  @IsEnum(WalletType)
  fromWalletType: WalletType;

  @IsEnum(WalletType)
  toWalletType: WalletType;

  @IsString()
  currency: string;

  @IsNumber()
  amount: number;
}
