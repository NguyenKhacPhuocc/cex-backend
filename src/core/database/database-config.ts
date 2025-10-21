import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';
import { Market } from 'src/modules/market/entities/market.entity';
import { Order } from 'src/modules/order/entities/order.entity';
import { Trade } from 'src/modules/trades/entities/trade.entity';
import { Transaction } from 'src/modules/transactions/entities/transaction.entity';
import { UserProfile } from 'src/modules/users/entities/user-profile.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { LedgerEntry } from 'src/modules/ledger/entities/ledger.entity';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';

dotenv.config();

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  synchronize: process.env.NODE_ENV === 'development',
  // logging: process.env.NODE_ENV === 'development',
  entities: [
    User,
    UserProfile,
    Wallet,
    Transaction,
    LedgerEntry,
    Order,
    Trade,
    Market,
  ],
  // migrations: ['src/migrations/*.ts'],
  // migrationsRun: true,
  // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
};
