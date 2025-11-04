import { Module } from '@nestjs/common';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './entities/trade.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Trade])],
  providers: [TradesService],
  controllers: [TradesController],
  exports: [TradesService, TypeOrmModule],
})
export class TradesModule {}
