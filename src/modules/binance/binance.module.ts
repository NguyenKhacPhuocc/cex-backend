import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BinanceService } from './binance.service';
import { RedisModule } from 'src/core/redis/redis.module';
import { Market } from '../market/entities/market.entity';

@Module({
  imports: [RedisModule, TypeOrmModule.forFeature([Market])],
  providers: [BinanceService],
  exports: [BinanceService],
})
export class BinanceModule {}
