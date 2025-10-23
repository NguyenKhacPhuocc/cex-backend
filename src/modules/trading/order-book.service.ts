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

  async add(order: Order): Promise<void> {
    const key = this.getBookKey(order.market.symbol, order.side);
    const score = order.side === OrderSide.BUY ? -order.price : order.price;
    const value = JSON.stringify(order);
    await this.redis.zadd(key, score, value);
    this.logger.log(`Added order ${order.id} to order book ${key} with status ${order.status}`);
  }

  async getBest(
    symbol: string,
    side: OrderSide,
  ): Promise<Order | null> {
    const key = this.getBookKey(symbol, side);
    const range =
      side === OrderSide.BUY
        ? await this.redis.zrange(key, 0, 0)
        : await this.redis.zrange(key, 0, 0);
    if (!range.length) return null;
    return JSON.parse(range[0]);
  }

  async remove(order: Order): Promise<void> {
    const key = this.getBookKey(order.market.symbol, order.side);
    const value = JSON.stringify(order);
    await this.redis.zrem(key, value);
    this.logger.log(`Removed order ${order.id} from order book ${key}`);
  }
}
