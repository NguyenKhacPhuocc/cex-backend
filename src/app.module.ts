import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './core/database/database.module';
import { RedisModule } from './core/redis/redis.module';
import { CacheModule } from '@nestjs/cache-manager';
import { RedisConfigFactory } from './core/redis/redis-config.factory';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Cho phép sử dụng ConfigService ở mọi nơi
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      useClass: RedisConfigFactory,
    }),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    // MarketModule,
    // OrderModule,
    // TradesModule,
    // TradingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
