import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [MarketModule],
  controllers: [AdminController],
})
export class AdminModule {}
