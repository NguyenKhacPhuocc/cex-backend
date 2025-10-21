/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable prettier/prettier */
// src/modules/trading/services/orderbook-cache.service.ts
import { Injectable } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { Order } from "src/modules/order/entities/order.entity";

@Injectable()
export class OrderBookCacheService {
  constructor(private readonly redis: RedisService) { }

  private key(symbol: string, side: 'bids' | 'asks') {
    return `orderbook:${symbol}:${side}`;
  }

  async addOrder(
    symbol: string,
    side: 'bids' | 'asks',
    order: Order,
  ): Promise<void> {
    await this.redis.zadd(
      this.key(symbol, side),
      order.price,
      JSON.stringify(order),
    );
  }

  async removeOrder(
    symbol: string,
    side: 'bids' | 'asks',
    order: Order,
  ): Promise<void> {
    await this.redis.zrem(this.key(symbol, side), JSON.stringify(order));
  }

  async getTopOrders(
    symbol: string,
    side: 'bids' | 'asks',
    limit = 20,
  ): Promise<Order[]> {
    const list = await this.redis.zrange(this.key(symbol, side), 0, limit - 1);
    return list.map((x) => JSON.parse(x));
  }
}
