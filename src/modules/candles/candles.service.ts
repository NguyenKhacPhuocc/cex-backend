import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Candle, Timeframe } from './entities/candle.entity';
import { Trade } from '../trades/entities/trade.entity';
import { CandleDto } from './dtos/candle.dto';

@Injectable()
export class CandlesService {
  private readonly logger = new Logger(CandlesService.name);

  // Timeframe to milliseconds mapping
  private readonly timeframeMs: Record<Timeframe, number> = {
    [Timeframe.ONE_SECOND]: 1000,
    [Timeframe.ONE_MINUTE]: 60 * 1000,
    [Timeframe.FIVE_MINUTES]: 5 * 60 * 1000,
    [Timeframe.FIFTEEN_MINUTES]: 15 * 60 * 1000,
    [Timeframe.THIRTY_MINUTES]: 30 * 60 * 1000,
    [Timeframe.ONE_HOUR]: 60 * 60 * 1000,
    [Timeframe.FOUR_HOURS]: 4 * 60 * 60 * 1000,
    [Timeframe.ONE_DAY]: 24 * 60 * 60 * 1000,
    [Timeframe.ONE_WEEK]: 7 * 24 * 60 * 60 * 1000,
  };

  constructor(
    @InjectRepository(Candle)
    private candleRepository: Repository<Candle>,
  ) {}

  /**
   * Get time bucket for a given timestamp and timeframe
   */
  private getTimeBucket(timestamp: Date, timeframe: Timeframe): Date {
    const ms = this.timeframeMs[timeframe];
    const timestampMs = timestamp.getTime();
    const bucketMs = Math.floor(timestampMs / ms) * ms;
    return new Date(bucketMs);
  }

  /**
   * Aggregate a trade into a candle
   */
  async aggregateTradeToCandle(
    trade: Trade,
    timeframes: Timeframe[],
  ): Promise<Map<Timeframe, Candle>> {
    const result = new Map<Timeframe, Candle>();

    for (const timeframe of timeframes) {
      const candle = await this.aggregateTradeToCandleSingle(trade, timeframe);
      if (candle) {
        result.set(timeframe, candle);
      }
    }

    return result;
  }

  /**
   * Aggregate a single trade into a single candle for a given timeframe
   */
  private async aggregateTradeToCandleSingle(
    trade: Trade,
    timeframe: Timeframe,
  ): Promise<Candle | null> {
    try {
      const bucketTime = this.getTimeBucket(trade.timestamp, timeframe);

      // Get existing candle from database
      let candle = await this.candleRepository.findOne({
        where: {
          symbol: trade.market.symbol,
          timeframe,
          timestamp: bucketTime,
        },
        relations: ['market'],
      });

      if (!candle) {
        // Create new candle
        const price = Number(trade.price);
        const amount = Number(trade.amount);

        // Get previous candle - new candle's open = previous candle's close (no gaps)
        let openPrice = price; // Default to current trade price (for first candle ever)

        try {
          // Find the most recent candle BEFORE the current bucket time
          // Use LessThan to ensure we only get candles that are actually before this bucket
          const previousCandle = await this.candleRepository.findOne({
            where: {
              symbol: trade.market.symbol,
              timeframe,
              timestamp: LessThan(bucketTime), // Only candles before current bucket
            },
            order: {
              timestamp: 'DESC',
            },
          });

          if (previousCandle) {
            // New candle opens at previous candle's close price (no gaps)
            openPrice = Number(previousCandle.close);
            this.logger.debug(
              `New candle for ${trade.market.symbol} ${timeframe}: open=${openPrice} (from previous close), bucketTime=${bucketTime.toISOString()}`,
            );
          } else {
            this.logger.debug(
              `First candle for ${trade.market.symbol} ${timeframe}: open=${openPrice} (first trade price)`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Error finding previous candle for ${trade.market.symbol} ${timeframe}: ${(error as Error).message}`,
          );
          openPrice = price;
        }

        candle = this.candleRepository.create({
          symbol: trade.market.symbol,
          timeframe,
          open: openPrice,
          high: Math.max(openPrice, price),
          low: Math.min(openPrice, price),
          close: price,
          volume: amount,
          timestamp: bucketTime,
          market: trade.market,
        });
      } else {
        // Ensure candle has market reference before updating
        if (!candle.market) {
          candle.market = trade.market;
        }

        // Update existing candle
        const price = Number(trade.price);
        const amount = Number(trade.amount);

        // IMPORTANT: Convert existing values to numbers (TypeORM may return decimals as strings)
        const currentHigh = Number(candle.high);
        const currentLow = Number(candle.low);
        const currentVolume = Number(candle.volume);

        // Normal flow: update high, low, close (DO NOT change open - it's the first price in the candle)
        candle.high = Math.max(currentHigh, price);
        candle.low = Math.min(currentLow, price);
        candle.close = price; // Last price becomes close
        candle.volume = currentVolume + amount;
      }

      // Save to database
      candle = await this.candleRepository.save(candle);

      return candle;
    } catch {
      return null;
    }
  }

  /**
   * Get historical candles for a symbol and timeframe
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    from?: Date,
    to?: Date,
    limit: number = 500,
  ): Promise<CandleDto[]> {
    const query = this.candleRepository
      .createQueryBuilder('candle')
      .where('candle.symbol = :symbol', { symbol })
      .andWhere('candle.timeframe = :timeframe', { timeframe })
      .orderBy('candle.timestamp', 'DESC');

    if (from) {
      query.andWhere('candle.timestamp >= :from', { from });
    }

    if (to) {
      query.andWhere('candle.timestamp <= :to', { to });
    }

    if (limit) {
      query.limit(limit);
    }

    const candles = await query.getMany();

    // Reverse to get chronological order (lightweight-charts expects oldest first)
    candles.reverse();

    // Convert to DTO format expected by lightweight-charts (Unix timestamp in seconds)
    return candles.map((candle) => ({
      time: Math.floor(candle.timestamp.getTime() / 1000),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    }));
  }

  /**
   * Get current (incomplete) candle for a symbol and timeframe
   */
  async getCurrentCandle(symbol: string, timeframe: Timeframe): Promise<Candle | null> {
    const now = new Date();
    const bucketTime = this.getTimeBucket(now, timeframe);

    return await this.candleRepository.findOne({
      where: {
        symbol,
        timeframe,
        timestamp: bucketTime,
      },
    });
  }
}
