import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CandlesService } from './candles.service';
import { CandlesController } from './candles.controller';
import { Candle } from './entities/candle.entity';
import { Trade } from '../trades/entities/trade.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Candle, Trade])],
  providers: [CandlesService],
  controllers: [CandlesController],
  exports: [CandlesService],
})
export class CandlesModule {}
