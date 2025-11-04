import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';
import { Trade } from '../trades/entities/trade.entity';
import { Order } from '../order/entities/order.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Market } from '../market/entities/market.entity';
import { Candle } from '../candles/entities/candle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Trade, Order, Wallet, Market, Candle])],
  controllers: [DevController],
  providers: [DevService],
  exports: [DevService],
})
export class DevModule {}
