import { Module, forwardRef } from '@nestjs/common';
import { MatchingEngineService } from './matching-engine.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from 'src/modules/order/entities/order.entity';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';
import { Trade } from 'src/modules/trades/entities/trade.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { Market } from 'src/modules/market/entities/market.entity';
import { OrderModule } from 'src/modules/order/order.module';
import { WalletsModule } from 'src/modules/wallets/wallets.module';
import { TradesModule } from 'src/modules/trades/trades.module';
import { UsersModule } from 'src/modules/users/users.module';
import { MarketModule } from 'src/modules/market/market.module';
import { TradingModule } from '../trading/trading.module';
import { Transaction } from '../transactions/entities/transaction.entity';
import { LedgerEntry } from '../ledger/entities/ledger.entity';
import { TransactionsModule } from '../transactions/transactions.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [
    forwardRef(() => TradingModule),
    TypeOrmModule.forFeature([
      Order,
      Wallet,
      Trade,
      User,
      Market,
      Transaction,
      LedgerEntry,
    ]),
    OrderModule,
    WalletsModule,
    TradesModule,
    UsersModule,
    MarketModule,
    forwardRef(() => TradingModule),
    TransactionsModule,
    LedgerModule,
  ],
  providers: [MatchingEngineService],
  exports: [MatchingEngineService],
})
export class MatchingEngineModule {}
