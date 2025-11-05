import { Controller, Get, Param, Query, ParseEnumPipe, Post, Body } from '@nestjs/common';
import { CandlesService } from './candles.service';
import { Timeframe } from './entities/candle.entity';

@Controller('candles')
export class CandlesController {
  constructor(private readonly candlesService: CandlesService) {}

  @Get(':symbol')
  async getCandles(
    @Param('symbol') symbol: string,
    @Query('timeframe', new ParseEnumPipe(Timeframe)) timeframe: Timeframe,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: number,
  ) {
    return this.candlesService.getCandles(
      symbol,
      timeframe,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit || 500,
    );
  }

  @Get(':symbol/current')
  async getCurrentCandle(
    @Param('symbol') symbol: string,
    @Query('timeframe', new ParseEnumPipe(Timeframe)) timeframe: Timeframe,
  ) {
    return this.candlesService.getCurrentCandle(symbol, timeframe);
  }

  @Post(':symbol/backfill')
  async backfillCandles(
    @Param('symbol') symbol: string,
    @Body('timeframes') timeframes: Timeframe[],
  ) {
    return this.candlesService.backfillCandles(symbol, timeframes);
  }
}
