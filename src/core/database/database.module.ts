import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './database-config';
import { User } from 'src/modules/users/entities/user.entity';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';
import { Order } from 'src/modules/order/entities/order.entity';
import { Trade } from 'src/modules/trades/entities/trade.entity';
import { UserRepository } from 'src/modules/users/repositories/user.repository';
import { WalletRepository } from 'src/modules/wallets/repositories/wallet.repository';
import { Market } from 'src/modules/market/entities/market.entity';
import { UserProfile } from 'src/modules/users/entities/user-profile.entity';
import { LedgerEntry } from 'src/modules/ledger/entities/ledger.entity';
import { Transaction } from 'src/modules/transactions/entities/transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    TypeOrmModule.forFeature([
      User,
      UserProfile,
      Wallet,
      Transaction,
      LedgerEntry,
      Order,
      Trade,
      Market,
    ]),
  ],
  providers: [
    UserRepository,
    WalletRepository,
    // MarketRepository,
    // OrderRepository,
    // TradeRepository,
  ],
  exports: [
    TypeOrmModule,
    UserRepository,
    WalletRepository,
    // MarketRepository,
    // OrderRepository,
    // TradeRepository,
  ],
})
export class DatabaseModule {}
