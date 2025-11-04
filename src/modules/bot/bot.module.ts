import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotService } from './bot.service';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Market } from '../market/entities/market.entity';
import { OrderModule } from '../order/order.module';
import { BinanceModule } from '../binance/binance.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Wallet, Market]), OrderModule, BinanceModule],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule {}
