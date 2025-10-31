import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Market } from './entities/market.entity';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { Trade } from '../trades/entities/trade.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Market, Trade])],
  providers: [MarketService],
  controllers: [MarketController],
  exports: [MarketService],
})
export class MarketModule {}
