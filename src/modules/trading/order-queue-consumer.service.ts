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
  ) {
    this.logger.log(`🚀 OrderQueueConsumerService CONSTRUCTOR CALLED`);
  }

  onModuleInit() {
    this.logger.log(`🔥 OrderQueueConsumerService OnModuleInit CALLED`);
    this.logger.log(`📋 PAIR_LIST: ${JSON.stringify(PAIR_LIST)}`);

    PAIR_LIST.forEach((symbol) => {
      this.logger.log(`🎯 Starting listener for symbol: ${symbol.name}`);
      this.startListening(symbol.name);
    });

    this.logger.log(`✅ All listeners started successfully`);
  }

  private async startListening(symbol: string) {
    this.logger.log(`🎧 Starting to listen for orders on queue: ${symbol}`);
    while (true) {
      try {
        this.logger.debug(`⏳ Waiting for order from queue: ${symbol}`);
        const order = await this.orderQueue.dequeue(symbol);
        if (order) {
          this.logger.log(`📦 Dequeued order ${order.id} from queue ${symbol}`);
          this.logger.log(
            `📊 Order details: ${JSON.stringify({ side: order.side, price: order.price, amount: order.amount })}`,
          );

          // Process the order using the matching engine
          this.logger.log(`⚙️ Processing order ${order.id} with matching engine...`);
          await this.matchingEngine.processOrder(order);
          this.logger.log(`✅ Order ${order.id} processed successfully`);
        } else {
          this.logger.debug(`⏭️ No order found, continuing...`);
        }
      } catch (error) {
        this.logger.error(`❌ Error processing order from queue ${symbol}:`, error.stack);
        // Sleep for a bit to avoid tight loop on persistent errors
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}
