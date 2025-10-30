import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';
import { User } from '../users/entities/user.entity';
import { WalletsController } from './wallets.controller';
import { BalancesController } from './balances.controller';
import { Transaction } from '../transactions/entities/transaction.entity';
import { LedgerEntry } from '../ledger/entities/ledger.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, User, Transaction, LedgerEntry])],
  controllers: [WalletsController, BalancesController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
