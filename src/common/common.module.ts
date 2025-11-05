import { Global, Module } from '@nestjs/common';
import { WalletCalculationService } from './services/wallet-calculation.service';

@Global()
@Module({
  providers: [WalletCalculationService],
  exports: [WalletCalculationService],
})
export class CommonModule {}
