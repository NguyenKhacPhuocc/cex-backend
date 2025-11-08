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
import { Candle } from 'src/modules/candles/entities/candle.entity';

dotenv.config();

// Detect if SSL is required from DATABASE_URL (e.g., ?sslmode=require from Neon, Supabase)
const getSSLConfig = (): boolean | object => {
  const dbUrl = process.env.DATABASE_URL;

  // Check if URL contains sslmode=require
  if (dbUrl && dbUrl.includes('sslmode=require')) {
    return { rejectUnauthorized: false };
  }

  // Enable SSL for production (most cloud databases require SSL)
  if (process.env.NODE_ENV === 'production') {
    return { rejectUnauthorized: false };
  }

  return false;
};

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // Synchronize schema with entities (enabled in development, disabled in production)
  // For production: use migrations instead
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV === 'development',
  entities: [User, UserProfile, Wallet, Transaction, LedgerEntry, Order, Trade, Market, Candle],
  // Enable SSL if URL contains sslmode=require or if in production
  ssl: getSSLConfig(),
  schema: 'public',
  // Connection pool settings for better performance
  // Increased to handle high concurrency from bot service (30+ bots)
  extra: {
    max: 50, // Maximum pool size (increased from 20 to handle more concurrent connections)
    min: 5, // Minimum pool size (increased from 2 for better connection availability)
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000, // Increased from 2000ms to 10000ms (10 seconds) to prevent timeout errors
    statement_timeout: 30000, // 30 seconds timeout for long-running queries
  },
};
