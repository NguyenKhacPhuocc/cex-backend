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
    await this.redis.lpush(this.getQueueKey(symbol), JSON.stringify(order));
  }

  async dequeue(symbol: string): Promise<Order | null> {
    // Use non-blocking rpop for instant order processing
    // If no order available, return null immediately without waiting
    const value = await this.redis.rpop(this.getQueueKey(symbol));
    if (!value || typeof value !== 'string') return null;
    return JSON.parse(value) as Order;
  }
}
