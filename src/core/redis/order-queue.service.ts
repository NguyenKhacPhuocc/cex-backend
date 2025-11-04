/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable prettier/prettier */
// src/modules/trading/services/order-queue.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/core/redis/redis.service';
import { Order } from 'src/modules/order/entities/order.entity';

@Injectable()
export class OrderQueueService {
  private readonly logger = new Logger(OrderQueueService.name);

  constructor(private readonly redis: RedisService) {}

  private getQueueKey(symbol: string) {
    return `orderQueue:${symbol}`;
  }

  async enqueue(symbol: string, order: Order): Promise<void> {
    // console.log('enqueue symbol data:', symbol);
    // console.log('enqueue order data:', order);
    await this.redis.lpush(this.getQueueKey(symbol), JSON.stringify(order));
    // console.log(`Order ${order.id} pushed to queue ${symbol}`);
  }

  async dequeue(symbol: string): Promise<Order | null> {
    const result = await this.redis.brpop(this.getQueueKey(symbol), 1); // Timeout 1 second
    // console.log('dequeue result data:', result);
    if (!result) return null;
    const [, value] = result;
    return JSON.parse(value);
  }
}
