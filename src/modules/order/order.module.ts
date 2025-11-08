import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { MarketModule } from '../market/market.module';
import { OrderBookCacheService } from 'src/core/redis/orderbook-cache.service';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Trade } from '../trades/entities/trade.entity';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { WebSocketModule } from 'src/core/websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Wallet, Trade]),
    MarketModule,
    forwardRef(() => WebSocketModule),
  ],
  providers: [OrderService, OrderBookCacheService, OrderQueueService],
  controllers: [OrderController],
  exports: [OrderService],
})
export class OrderModule {}
