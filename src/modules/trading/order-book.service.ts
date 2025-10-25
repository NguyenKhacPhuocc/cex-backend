/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable prettier/prettier */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/core/redis/redis.service';
import { Order } from 'src/modules/order/entities/order.entity';
import { OrderSide } from 'src/shared/enums/order-side.enum';

@Injectable()
export class OrderBookService {
  private readonly logger = new Logger(OrderBookService.name);

  constructor(private readonly redis: RedisService) { }

  private getBookKey(symbol: string, side: OrderSide): string {
    return `orderbook:${symbol}:${side}`;
  }

  private getOrderHashKey(symbol: string): string {
    return `orders:${symbol}`;
  }

  async add(order: Order): Promise<void> {
    const bookKey = this.getBookKey(order.market.symbol, order.side);
    const score = order.side === OrderSide.BUY ? -order.price : order.price;
    
    // Store the full order in a hash
    const hashKey = this.getOrderHashKey(order.market.symbol);
    await this.redis.hset(hashKey, order.id, JSON.stringify(order));

    // Store only the order ID in the sorted set
    await this.redis.zadd(bookKey, score, order.id);

    this.logger.log(`Added order ${order.id} to order book ${bookKey}`);
  }

  async getBest(
    symbol: string,
    side: OrderSide,
  ): Promise<Order | null> {
    const bookKey = this.getBookKey(symbol, side);
    const range = await this.redis.zrange(bookKey, 0, 0);

    if (!range.length) return null;

    const orderId = range[0];
    const hashKey = this.getOrderHashKey(symbol);
    const orderData = await this.redis.hget(hashKey, orderId);

    if (!orderData) return null;

    return JSON.parse(orderData);
  }

  async remove(order: Order): Promise<void> {
    const bookKey = this.getBookKey(order.market.symbol, order.side);
    const hashKey = this.getOrderHashKey(order.market.symbol);

    // Remove the order ID from the sorted set
    await this.redis.zrem(bookKey, order.id);

    // Remove the order data from the hash
    await this.redis.hdel(hashKey, order.id);

    this.logger.log(`Removed order ${order.id} from order book ${bookKey}`);
  }
}
