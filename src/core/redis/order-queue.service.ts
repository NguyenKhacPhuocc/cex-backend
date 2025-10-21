/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable prettier/prettier */
// src/modules/trading/services/order-queue.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from 'src/core/redis/redis.service';
import { Order } from 'src/modules/order/entities/order.entity';

@Injectable()
export class OrderQueueService {
  private readonly logger = new Logger(OrderQueueService.name);

  constructor(private readonly redis: RedisService) { }

  private getQueueKey(symbol: string) {
    return `orderQueue:${symbol}`;
  }

  async enqueue(symbol: string, order: Order): Promise<void> {
    await this.redis.lpush(this.getQueueKey(symbol), JSON.stringify(order));
    this.logger.log(`Order ${order.id} pushed to queue ${symbol}`);
  }

  async dequeue(symbol: string): Promise<Order | null> {
    const result = await this.redis.brpop(this.getQueueKey(symbol), 0);
    if (!result) return null;
    const [, value] = result;
    return JSON.parse(value);
  }
}
