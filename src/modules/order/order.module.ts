import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { MarketModule } from '../market/market.module';
import { OrderBookCacheService } from 'src/core/redis/orderbook-cache.service';
import { Wallet } from '../wallets/entities/wallet.entity';
import { OrderQueueService } from 'src/core/redis/order-queue.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Wallet]), MarketModule],
  providers: [OrderService, OrderBookCacheService, OrderQueueService],
  controllers: [OrderController],
})
export class OrderModule {}
