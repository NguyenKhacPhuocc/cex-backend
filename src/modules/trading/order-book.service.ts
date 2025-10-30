/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/core/redis/redis.service';
import { Order } from 'src/modules/order/entities/order.entity';
import { OrderSide } from 'src/shared/enums/order-side.enum';

@Injectable()
export class OrderBookService {
  private readonly logger = new Logger(OrderBookService.name);

  constructor(private readonly redis: RedisService) {}

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

  async getBest(symbol: string, side: OrderSide): Promise<Order | null> {
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

  /**
   * Get orderbook snapshot for WebSocket
   * Returns top N asks and bids with aggregated amounts by price level
   */
  async getOrderBookSnapshot(
    symbol: string,
    depth = 20,
  ): Promise<{
    symbol: string;
    asks: Array<{ price: number; amount: number; total: number }>;
    bids: Array<{ price: number; amount: number; total: number }>;
  }> {
    const hashKey = this.getOrderHashKey(symbol);

    // Get top asks (sorted by price ascending)
    const askBookKey = this.getBookKey(symbol, OrderSide.SELL);
    const askIds = await this.redis.zrange(askBookKey, 0, depth - 1);

    // Get top bids (sorted by price descending via negative score)
    const bidBookKey = this.getBookKey(symbol, OrderSide.BUY);
    const bidIds = await this.redis.zrange(bidBookKey, 0, depth - 1);

    // Fetch full order data
    const askOrders = await Promise.all(
      askIds.map(async (id) => {
        const data = await this.redis.hget(hashKey, id);
        return data ? JSON.parse(data) : null;
      }),
    );

    const bidOrders = await Promise.all(
      bidIds.map(async (id) => {
        const data = await this.redis.hget(hashKey, id);
        return data ? JSON.parse(data) : null;
      }),
    );

    // Aggregate by price level
    const aggregateOrders = (
      orders: Order[],
    ): Array<{ price: number; amount: number; total: number }> => {
      const priceMap = new Map<number, { amount: number; total: number }>();

      orders
        .filter((o) => o !== null)
        .forEach((order) => {
          const price = Number(order.price);
          const amount = Number(order.amount);
          const existing = priceMap.get(price);

          if (existing) {
            existing.amount += amount;
            existing.total = existing.amount * price;
          } else {
            priceMap.set(price, {
              amount,
              total: amount * price,
            });
          }
        });

      return Array.from(priceMap.entries())
        .map(([price, data]) => ({
          price,
          amount: data.amount,
          total: data.total,
        }))
        .sort((a, b) => a.price - b.price); // Sort by price ascending
    };

    const asks = aggregateOrders(askOrders);
    const bids = aggregateOrders(bidOrders).reverse(); // Reverse to get descending

    return {
      symbol,
      asks,
      bids,
    };
  }
}
