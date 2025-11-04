import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './core/database/database.module';
import { RedisModule } from './core/redis/redis.module';
import { WebSocketModule } from './core/websocket/websocket.module';
import { CacheModule } from '@nestjs/cache-manager';
import { RedisConfigFactory } from './core/redis/redis-config.factory';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { MarketModule } from './modules/market/market.module';
import { AdminModule } from './modules/admin/admin.module';
import { OrderModule } from './modules/order/order.module';
import { TradingModule } from './modules/trading/trading.module';
import { MatchingEngineModule } from './modules/matching-engine/matching-engine.module';
import { TradesModule } from './modules/trades/trades.module';
import { DevModule } from './modules/dev/dev.module';
import { CandlesModule } from './modules/candles/candles.module';
import { BinanceModule } from './modules/binance/binance.module';
import { BotModule } from './modules/bot/bot.module';
import { ThrottlerModule } from '@nestjs/throttler';
// import { APP_GUARD } from '@nestjs/core';
// import { CustomThrottlerGuard } from './common/guards/custom-throttler.guard';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Cho phép sử dụng ConfigService ở mọi nơi
    }),
    // Rate Limiting - Global configuration
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 seconds
        limit: 500, // 500 requests per minute (increased for real-time updates)
      },
      {
        name: 'auth',
        ttl: 60000, // 60 seconds
        limit: 5, // 5 requests per minute for auth endpoints
      },
    ]),
    CacheModule.registerAsync({
      isGlobal: true,
      useClass: RedisConfigFactory,
    }),
    DatabaseModule,
    RedisModule,
    WebSocketModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    MarketModule,
    AdminModule,
    OrderModule,
    TradingModule,
    MatchingEngineModule,
    TradesModule,
    DevModule,
    CandlesModule,
    BinanceModule,
    BotModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Apply custom throttler globally with smart skipping for balance endpoints
    // {
    //   provide: APP_GUARD,
    //   useClass: CustomThrottlerGuard,
    // },
  ],
})
export class AppModule {}
