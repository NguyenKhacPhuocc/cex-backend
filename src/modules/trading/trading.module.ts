import { Module, forwardRef } from '@nestjs/common';
import { OrderBookService } from './order-book.service';
import { OrderQueueConsumerService } from './order-queue-consumer.service';
import { MatchingEngineModule } from '../matching-engine/matching-engine.module';
import { OrderQueueService } from 'src/core/redis/order-queue.service';

@Module({
  imports: [forwardRef(() => MatchingEngineModule)],
  providers: [OrderQueueService, OrderBookService, OrderQueueConsumerService],
  exports: [OrderBookService],
})
export class TradingModule {}
