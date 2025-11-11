import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../../core/redis/redis.service';
import { Market, MarketStatus } from '../market/entities/market.entity';
import axios from 'axios';

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private pricePollingInterval: NodeJS.Timeout | null = null;
  private symbolToInternalMap: Map<string, string> = new Map();
  private latestPrices: Map<string, number> = new Map();

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
  ) {}

  onModuleInit() {
    const enabled = this.configService.get<string>('BINANCE_ENABLED', 'true');
    if (enabled === 'true') {
      void this.initializeSymbolMapping();
      this.startPricePolling();
    }
  }

  onModuleDestroy() {
    this.stopPricePolling();
  }

  /**
   * Initialize mapping from Binance symbols to internal symbols
   * Fetches active markets from database dynamically
   */
  private async initializeSymbolMapping(): Promise<void> {
    try {
      // Fetch all active markets from database
      const markets = await this.marketRepo.find({
        where: { status: MarketStatus.ACTIVE },
      });

      if (markets.length === 0) {
        this.logger.warn('[BINANCE_INIT]   No active markets found in database');
        return;
      }

      // Map Binance symbols to internal symbols based on market symbol
      // Example: BTC_USDT -> BTCUSDT (Binance format)
      for (const market of markets) {
        const binanceSymbol = market.symbol.replace('_', '').toUpperCase();
        this.symbolToInternalMap.set(binanceSymbol, market.symbol);
      }

      const mapSize = this.symbolToInternalMap.size;
      this.logger.log(`[BINANCE_INIT]  Symbol mapping initialized with ${mapSize} markets`);
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[BINANCE_INIT]   Failed to initialize: ${msg}`);
    }
  }

  /**
   * Start polling Binance API for prices
   * Binance: api.binance.com (global, free, no API key needed for public endpoints)
   * Rate limit: 1200 requests per minute (20/second) - very generous
   */
  private startPricePolling(): void {
    this.logger.log('[PRICE_POLLING]  Starting Binance API polling...');

    // Initial fetch
    void this.fetchPricesFromBinance();

    // Poll every 3 seconds (safe, fast updates for candles)
    this.pricePollingInterval = setInterval(() => {
      void this.fetchPricesFromBinance();
    }, 3000);

    this.logger.log('[PRICE_POLLING]  Price polling started (3s interval)');
  }

  private stopPricePolling(): void {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
      this.logger.log('[PRICE_POLLING]  Price polling stopped');
    }
  }

  /**
   * Fetch prices from Binance API
   * Binance endpoint: https://api.binance.com (global)
   * Single symbol endpoint: /api/v3/ticker/price?symbol=BTCUSDT
   * Fetch multiple symbols in parallel using Promise.allSettled
   */
  private async fetchPricesFromBinance(): Promise<void> {
    try {
      // Get symbols we need to fetch
      const symbolsNeeded = Array.from(this.symbolToInternalMap.keys());
      if (symbolsNeeded.length === 0) return;

      const prices: Map<string, number> = new Map();

      // Fetch prices individually (more reliable than batch request)
      // Use Promise.allSettled to fetch in parallel but don't fail if one symbol errors
      const fetchPromises = symbolsNeeded.map(async (symbol) => {
        try {
          const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
          const response = await axios.get(url, { timeout: 3000 });

          if (response.status === 200 && response.data) {
            const data = response.data as { symbol: string; price: string };
            const price = parseFloat(data.price);

            if (!isNaN(price) && price > 0) {
              prices.set(data.symbol, price);
            }
          }
        } catch (error) {
          // Log error but don't throw - continue with other symbols
          // Only log if it's not a 404 (symbol might not exist on Binance)
          if (error instanceof axios.AxiosError && error.response?.status !== 404) {
            this.logger.debug(
              `[BINANCE_API] Failed to fetch price for ${symbol}: ${error.message}`,
            );
          }
        }
      });

      // Wait for all requests to complete (or fail)
      await Promise.allSettled(fetchPromises);

      // Process prices and update Redis
      if (prices.size > 0) {
        this.processBinancePrices(prices);
        this.flushPricesToRedis();
      }
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[BINANCE_API]   Failed to fetch prices: ${msg}`);
    }
  }

  /**
   * Process Binance prices and map to internal symbols
   */
  private processBinancePrices(prices: Map<string, number>): void {
    for (const [binanceSymbol, price] of prices) {
      const internalSymbol = this.symbolToInternalMap.get(binanceSymbol);
      if (!internalSymbol) continue;

      this.latestPrices.set(internalSymbol, price);
    }
  }

  /**
   * Flush latest prices to Redis with 5-second TTL
   */
  private flushPricesToRedis(): void {
    const entries = Array.from(this.latestPrices.entries());
    if (entries.length === 0) return;

    for (const [internalSymbol, price] of entries) {
      const key = `binance:price:${internalSymbol}`;
      void this.redisService.set(key, String(price), 5); // 5s TTL
    }

    // Removed log to reduce spam - prices are saved to Redis with TTL
  }

  /**
   * Get last price for a symbol from Redis cache
   * Used by bot and other services to get current price
   */
  async getLastPrice(symbol: string): Promise<number | null> {
    try {
      const cached = await this.redisService.get(`binance:price:${symbol}`);
      if (cached) {
        const price = parseFloat(cached);
        return price;
      }

      // Fallback to in-memory cache if Redis is unavailable or expired
      const memoryPrice = this.latestPrices.get(symbol);
      if (memoryPrice && memoryPrice > 0) {
        return memoryPrice;
      }

      // No price available in either cache
      return null;
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[REDIS_GET]   Failed to get price: ${msg}`);

      // Fallback to in-memory cache on error
      const memoryPrice = this.latestPrices.get(symbol);
      if (memoryPrice && memoryPrice > 0) {
        // this.logger.debug(
        //   `[REDIS_GET]   Using cached price after error for ${symbol}: ${memoryPrice}`,
        // );
        return memoryPrice;
      }

      return null;
    }
  }
}
