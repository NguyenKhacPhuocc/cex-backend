/* eslint-disable @typescript-eslint/no-unsafe-member-access */
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
    const score = order.side === OrderSide.BUY ? -Number(order.price) : Number(order.price);

    // Store the full order in a hash
    const hashKey = this.getOrderHashKey(order.market.symbol);

    // Ensure order has required fields before serialization
    if (
      !order.id ||
      !order.market ||
      !order.side ||
      order.price === null ||
      order.price === undefined
    ) {
      throw new Error(`Invalid order data: missing required fields`);
    }

    // Serialize order with only necessary fields to avoid circular references
    // Keep market as simple object with just id and symbol
    const orderToStore = {
      id: order.id,
      userId: order.userId || order.user?.id,
      user: order.user ? { id: order.user.id } : undefined,
      market: order.market
        ? {
            id: order.market.id,
            symbol: order.market.symbol,
          }
        : undefined,
      side: order.side,
      type: order.type,
      price: Number(order.price),
      amount: Number(order.amount),
      filled: Number(order.filled || 0),
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };

    const orderData = JSON.stringify(orderToStore);
    await this.redis.hset(hashKey, order.id, orderData);

    // Store only the order ID in the sorted set
    await this.redis.zadd(bookKey, score, order.id);
  }

  async getBest(symbol: string, side: OrderSide): Promise<Order | null> {
    const bookKey = this.getBookKey(symbol, side);
    const range = await this.redis.zrange(bookKey, 0, 0);

    if (!range.length) return null;

    const orderId = range[0];
    const hashKey = this.getOrderHashKey(symbol);
    const orderData = await this.redis.hget(hashKey, orderId);

    if (!orderData) {
      // Clean up orphaned order ID from sorted set
      await this.redis.zrem(bookKey, orderId);
      return null;
    }

    try {
      const order = JSON.parse(orderData) as Order;
      // Ensure order has valid structure
      if (!order.id || !order.side || !order.price || !order.amount) {
        // Invalid order data - remove it
        await this.remove({ id: orderId, side, market: { symbol } } as Order);
        return null;
      }
      return order;
    } catch {
      // Invalid JSON - remove corrupted data
      await this.redis.hdel(hashKey, orderId);
      await this.redis.zrem(bookKey, orderId);
      return null;
    }
  }

  async remove(order: Order): Promise<void> {
    const bookKey = this.getBookKey(order.market.symbol, order.side);
    const hashKey = this.getOrderHashKey(order.market.symbol);

    // Remove the order ID from the sorted set
    await this.redis.zrem(bookKey, order.id);

    // Remove the order data from the hash
    await this.redis.hdel(hashKey, order.id);
  }

  /**
   * Get orderbook snapshot for WebSocket
   * Returns top N asks and bids with aggregated amounts by price level
   */
  async getOrderBookSnapshot(
    symbol: string,
    depth = 100,
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
    const priceMap = new Map<number, { amount: number; total: number }>();

    // Aggregate asks (SELL orders)
    askOrders
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

    const asks = Array.from(priceMap.entries())
      .map(([price, data]) => ({
        price,
        amount: data.amount,
        total: data.total,
      }))
      .sort((a, b) => b.price - a.price); // Sort asks by price descending

    // Clear map for bids
    priceMap.clear();

    // Aggregate bids (BUY orders)
    bidOrders
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

    const bids = Array.from(priceMap.entries())
      .map(([price, data]) => ({
        price,
        amount: data.amount,
        total: data.total,
      }))
      .sort((a, b) => b.price - a.price); // Sort bids by price descending

    return {
      symbol,
      asks,
      bids,
    };
  }
}
