/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { MatchingEngineService } from '../matching-engine/matching-engine.service';
import { Market, MarketStatus } from '../market/entities/market.entity';
import { Order } from '../order/entities/order.entity';

@Injectable()
export class OrderQueueConsumerService implements OnModuleInit {
  private readonly logger = new Logger(OrderQueueConsumerService.name);

  constructor(
    private readonly orderQueue: OrderQueueService,
    private readonly matchingEngine: MatchingEngineService,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
  ) {}

  async onModuleInit() {
    // Load active markets from database
    const markets = await this.marketRepo.find({
      where: { status: MarketStatus.ACTIVE },
    });

    this.logger.log(`Starting order queue consumers for ${markets.length} markets`);

    markets.forEach((market) => {
      this.startListening(market.symbol);
      this.logger.debug(`Started listening for ${market.symbol}`);
    });
  }

  private async startListening(symbol: string) {
    // Process orders concurrently (max 10 concurrent orders per symbol)
    const maxConcurrent = 10;
    let activeProcesses = 0;
    const processingQueue: Array<() => Promise<void>> = [];

    const processOrder = async (order: unknown) => {
      activeProcesses++;
      try {
        // Process the order using the matching engine

        await this.matchingEngine.processOrder(order as Order);
      } catch {
        // Silently fail - errors are logged by matching engine if needed
      } finally {
        activeProcesses--;
        // Process next order from queue if any
        if (processingQueue.length > 0) {
          const nextProcessor = processingQueue.shift();
          if (nextProcessor) {
            nextProcessor();
          }
        }
      }
    };

    while (true) {
      try {
        const order = await this.orderQueue.dequeue(symbol);
        if (order) {
          if (activeProcesses < maxConcurrent) {
            // Process immediately if under concurrency limit
            processOrder(order).catch(() => {
              // Silently fail - errors are handled in processOrder
            });
          } else {
            // Queue for later processing
            processingQueue.push(() => processOrder(order));
          }
        } else {
          // No order available - use short sleep to avoid tight loop
          // but keep it very short (10ms) for responsive processing
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } catch (error) {
        // Log error for debugging but don't block for too long
        this.logger.error(`Error in order queue consumer for ${symbol}:`, error);
        // Short sleep to avoid tight loop on persistent errors
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}
