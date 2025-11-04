import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderBookService } from './order-book.service';
import { OrderQueueConsumerService } from './order-queue-consumer.service';
import { MatchingEngineModule } from '../matching-engine/matching-engine.module';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { Market } from '../market/entities/market.entity';

@Module({
  imports: [forwardRef(() => MatchingEngineModule), TypeOrmModule.forFeature([Market])],
  providers: [OrderQueueService, OrderBookService, OrderQueueConsumerService],
  exports: [OrderBookService],
})
export class TradingModule {}
