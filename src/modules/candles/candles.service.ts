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
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
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
    // Helper function to build query (reusable)
    const buildQuery = () => {
      const q = this.candleRepository
        .createQueryBuilder('candle')
        .where('candle.symbol = :symbol', { symbol })
        .andWhere('candle.timeframe = :timeframe', { timeframe })
        .orderBy('candle.timestamp', 'DESC');

      if (from) {
        q.andWhere('candle.timestamp >= :from', { from });
      }

      if (to) {
        q.andWhere('candle.timestamp <= :to', { to });
      }

      if (limit) {
        q.limit(limit);
      }

      return q;
    };

    let candles = await buildQuery().getMany();

    // Log for debugging
    this.logger.debug(`getCandles: Found ${candles.length} candles for ${symbol} ${timeframe}`);

    // Auto-backfill if no candles found for timeframes that might need backfill
    // This ensures these timeframes have data even if they weren't aggregated before
    // Includes 30m, 1h, 4h, 1d, 1w (these might not have been aggregated initially)
    if (
      candles.length === 0 &&
      [
        Timeframe.THIRTY_MINUTES,
        Timeframe.ONE_HOUR,
        Timeframe.FOUR_HOURS,
        Timeframe.ONE_DAY,
        Timeframe.ONE_WEEK,
      ].includes(timeframe)
    ) {
      this.logger.log(`No candles found for ${symbol} ${timeframe}, attempting auto-backfill...`);
      try {
        const backfillResults = await this.backfillCandles(symbol, [timeframe]);
        if (backfillResults.length > 0 && backfillResults[0].created > 0) {
          this.logger.log(
            `Auto-backfilled ${backfillResults[0].created} candles for ${symbol} ${timeframe}`,
          );
          // Re-query after backfill using a fresh query builder to get the newly created candles
          candles = await buildQuery().getMany();
          this.logger.debug(
            `After backfill: Found ${candles.length} candles for ${symbol} ${timeframe}`,
          );
        } else {
          this.logger.warn(
            `Backfill completed but no candles were created for ${symbol} ${timeframe}. This might mean there are no trades in the database.`,
          );
        }
      } catch (error) {
        this.logger.error(`Error during auto-backfill for ${symbol} ${timeframe}:`, error);
        // Don't throw - return empty array if backfill fails
      }
    }

    // Reverse to get chronological order (lightweight-charts expects oldest first)
    candles.reverse();

    // Fill gaps with empty candles to ensure continuous data
    const filledCandles = this.fillCandleGaps(candles, timeframe);

    // Convert to DTO format expected by lightweight-charts (Unix timestamp in seconds)
    return filledCandles.map((candle) => ({
      time: Math.floor(candle.timestamp.getTime() / 1000),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    }));
  }

  /**
   * Fill gaps between candles with empty candles (no trades in that period)
   * Empty candles have: open = close = previous close, high = low = previous close, volume = 0
   * Limits the number of empty candles to prevent excessive data generation
   */
  private fillCandleGaps(candles: Candle[], timeframe: Timeframe): Candle[] {
    if (candles.length === 0) {
      return candles;
    }

    const intervalMs = this.timeframeMs[timeframe];
    const filled: Candle[] = [candles[0]]; // Start with first candle
    const MAX_EMPTY_CANDLES_PER_GAP = 100; // Limit empty candles per gap to prevent excessive data
    let totalEmptyCandles = 0;
    const MAX_TOTAL_EMPTY_CANDLES = 500; // Total limit for all gaps combined

    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];

      const prevTime = prevCandle.timestamp.getTime();
      const currentTime = currentCandle.timestamp.getTime();
      const expectedNextTime = prevTime + intervalMs;

      // If there's a gap (more than one interval between candles)
      if (currentTime > expectedNextTime) {
        // Calculate how many intervals are missing
        const missingIntervals = Math.floor((currentTime - expectedNextTime) / intervalMs);
        const intervalsToFill = Math.min(
          missingIntervals,
          MAX_EMPTY_CANDLES_PER_GAP,
          MAX_TOTAL_EMPTY_CANDLES - totalEmptyCandles,
        );

        // Create empty candles for each missing interval (up to limit)
        for (let j = 1; j <= intervalsToFill; j++) {
          const gapTime = new Date(prevTime + j * intervalMs);
          const previousClose = Number(prevCandle.close);

          // Create empty candle: open = close = previous close, volume = 0
          // Note: We create a plain object, not a DB entity, since we don't save empty candles
          const emptyCandle: Candle = {
            id: '', // Not saved to DB, so no ID needed
            symbol: prevCandle.symbol,
            timeframe: prevCandle.timeframe,
            timestamp: gapTime,
            open: previousClose,
            high: previousClose,
            low: previousClose,
            close: previousClose,
            volume: 0,
            market: prevCandle.market,
            createdAt: gapTime,
            updatedAt: gapTime,
          } as Candle;

          filled.push(emptyCandle);
          totalEmptyCandles++;

          // Stop if we've reached the total limit
          if (totalEmptyCandles >= MAX_TOTAL_EMPTY_CANDLES) {
            this.logger.warn(
              `Reached maximum empty candles limit (${MAX_TOTAL_EMPTY_CANDLES}) while filling gaps. Some gaps may remain unfilled.`,
            );
            // Add remaining real candles and return
            filled.push(...candles.slice(i));
            return filled;
          }
        }

        // Log if we couldn't fill all gaps
        if (intervalsToFill < missingIntervals) {
          this.logger.debug(
            `Gap between ${new Date(prevTime).toISOString()} and ${new Date(currentTime).toISOString()} has ${missingIntervals} missing intervals, but only filled ${intervalsToFill} due to limits.`,
          );
        }
      }

      // Add the current candle
      filled.push(currentCandle);
    }

    return filled;
  }

  /**
   * Backfill candles for a symbol and specific timeframes from existing trades
   * This is useful when new timeframes are added and we need historical data
   */
  async backfillCandles(
    symbol: string,
    timeframes: Timeframe[],
  ): Promise<{ timeframe: Timeframe; created: number }[]> {
    this.logger.log(`Starting backfill for ${symbol} with timeframes: ${timeframes.join(', ')}`);

    const results: { timeframe: Timeframe; created: number }[] = [];

    // Get all trades for this symbol, ordered by timestamp
    const trades = await this.tradeRepository.find({
      where: { market: { symbol } },
      relations: ['market'],
      order: { timestamp: 'ASC' },
    });

    if (trades.length === 0) {
      this.logger.warn(`No trades found for ${symbol}, nothing to backfill`);
      return results;
    }

    this.logger.log(`Found ${trades.length} trades for ${symbol}`);

    // Process each timeframe
    for (const timeframe of timeframes) {
      let created = 0;

      // Process each trade
      for (const trade of trades) {
        const candle = await this.aggregateTradeToCandleSingle(trade, timeframe);
        if (candle) {
          // Check if candle already exists
          const existing = await this.candleRepository.findOne({
            where: {
              symbol: trade.market.symbol,
              timeframe,
              timestamp: candle.timestamp,
            },
          });

          if (!existing) {
            await this.candleRepository.save(candle);
            created++;
          }
        }
      }

      results.push({ timeframe, created });
      this.logger.log(`Backfilled ${created} candles for ${symbol} ${timeframe}`);
    }

    return results;
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
