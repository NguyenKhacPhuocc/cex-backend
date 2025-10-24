/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { MatchingEngineService } from '../matching-engine/matching-engine.service';
import { PAIR_LIST } from 'src/common/constants/pair-list';

@Injectable()
export class OrderQueueConsumerService implements OnModuleInit {
  private readonly logger = new Logger(OrderQueueConsumerService.name);

  constructor(
    private readonly orderQueue: OrderQueueService,
    private readonly matchingEngine: MatchingEngineService,
  ) {}

  onModuleInit() {
    PAIR_LIST.forEach((symbol) => {
      this.startListening(symbol.name);
    });
  }

  private async startListening(symbol: string) {
    this.logger.log(`Starting to listen for orders on queue: ${symbol}`);
    while (true) {
      try {
        const order = await this.orderQueue.dequeue(symbol);
        if (order) {
          this.logger.log(`Dequeued order ${order.id} from queue ${symbol}`);
          // Process the order using the matching engine
          await this.matchingEngine.processOrder(order);
        }
      } catch (error) {
        this.logger.error(
          `Error processing order from queue ${symbol}`,
          error.stack,
        );
      }
    }
  }
}
