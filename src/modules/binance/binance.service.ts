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
        this.logger.warn('[BINANCE_US_INIT]   No active markets found in database');
        return;
      }

      // Map Binance symbols to internal symbols based on market symbol
      // Example: BTC_USDT -> BTCUSDT (Binance format)
      for (const market of markets) {
        const binanceSymbol = market.symbol.replace('_', '').toUpperCase();
        this.symbolToInternalMap.set(binanceSymbol, market.symbol);
        this.logger.debug(`[BINANCE_US_INIT] Mapped ${binanceSymbol} → ${market.symbol}`);
      }

      const mapSize = this.symbolToInternalMap.size;
      this.logger.log(`[BINANCE_US_INIT]  Symbol mapping initialized with ${mapSize} markets`);
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[BINANCE_US_INIT]   Failed to initialize: ${msg}`);
    }
  }

  /**
   * Start polling Binance US API for prices
   * Binance US: api.binance.us (free, no geoblocking, supports US)
   * Rate limit: 1200 requests per minute (20/second) - very generous
   */
  private startPricePolling(): void {
    this.logger.log('[PRICE_POLLING]  Starting Binance US API polling...');

    // Initial fetch
    void this.fetchPricesFromBinanceUS();

    // Poll every 5 seconds (safe, fast updates for candles)
    this.pricePollingInterval = setInterval(() => {
      void this.fetchPricesFromBinanceUS();
    }, 3000);

    this.logger.log('[PRICE_POLLING]  Price polling started (5s interval)');
  }

  private stopPricePolling(): void {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
      this.logger.log('[PRICE_POLLING]  Price polling stopped');
    }
  }

  /**
   * Fetch prices from Binance US API
   * Binance US endpoint: https://api.binance.us (no geoblocking)
   * Free tier: 1200 requests/minute (very generous)
   * Endpoint: /api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT",...]
   */
  private async fetchPricesFromBinanceUS(): Promise<void> {
    try {
      // Get symbols we need to fetch
      const symbolsNeeded = Array.from(this.symbolToInternalMap.keys());
      if (symbolsNeeded.length === 0) return;

      const prices: Map<string, number> = new Map();

      // Batch request - fetch all prices in one call
      const symbolsParam = JSON.stringify(symbolsNeeded);
      const url = `https://api.binance.us/api/v3/ticker/price?symbols=${encodeURIComponent(symbolsParam)}`;

      this.logger.debug(`[BINANCE_US_API] 📡 Fetching from: ${url.substring(0, 80)}...`);

      const response = await axios.get(url, { timeout: 3000 });

      if (response.status !== 200) {
        this.logger.error(
          `[BINANCE_US_API]   HTTP Error ${response.status}: ${response.statusText}`,
        );
        return;
      }

      const data = response.data as Array<{ symbol: string; price: string }>;
      if (!Array.isArray(data) || data.length === 0) {
        this.logger.warn('[BINANCE_US_API]   No price data received');
        return;
      }

      // Process prices from response
      for (const item of data) {
        const binanceSymbol = item.symbol;
        const price = parseFloat(item.price);

        if (isNaN(price) || price <= 0) {
          this.logger.warn(`[BINANCE_US_API]   Invalid price for ${binanceSymbol}: ${item.price}`);
          continue;
        }

        prices.set(binanceSymbol, price);
      }

      // Process prices and update Redis
      if (prices.size > 0) {
        this.processBinancePrices(prices);
        this.flushPricesToRedis();
      }
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[BINANCE_US_API]   Failed to fetch prices: ${msg}`);
      if (error instanceof axios.AxiosError) {
        this.logger.debug(`[BINANCE_US_API] Error Code: ${error.code}`);
        this.logger.debug(`[BINANCE_US_API] Status: ${error.response?.status}`);
        this.logger.debug(`[BINANCE_US_API] URL: ${error.config?.url}`);
      }
    }
  }

  /**
   * Process Binance prices and map to internal symbols
   */
  private processBinancePrices(prices: Map<string, number>): void {
    const processedPrices: string[] = [];

    for (const [binanceSymbol, price] of prices) {
      const internalSymbol = this.symbolToInternalMap.get(binanceSymbol);
      if (!internalSymbol) continue;

      this.latestPrices.set(internalSymbol, price);
      processedPrices.push(`${internalSymbol}=${price.toFixed(2)}`);
    }

    if (processedPrices.length > 0) {
      const msg = processedPrices.join(', ');
      this.logger.log(`[BINANCE_US_PRICES]  Prices: ${msg}`);
    }
  }

  /**
   * Flush latest prices to Redis with 5-second TTL
   */
  private flushPricesToRedis(): void {
    const entries = Array.from(this.latestPrices.entries());
    if (entries.length === 0) return;

    const pricesForLog: string[] = [];
    for (const [internalSymbol, price] of entries) {
      const key = `binance:price:${internalSymbol}`;
      void this.redisService.set(key, String(price), 5); // 5s TTL
      pricesForLog.push(`${internalSymbol}=${price.toFixed(2)}`);
    }

    const msg = pricesForLog.join(', ');
    this.logger.log(`[REDIS_FLUSH] Saved to Redis: ${msg}`);
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
        this.logger.debug(
          `[REDIS_GET]   Redis unavailable for ${symbol}, using cached price: ${memoryPrice}`,
        );
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
        this.logger.debug(
          `[REDIS_GET]   Using cached price after error for ${symbol}: ${memoryPrice}`,
        );
        return memoryPrice;
      }

      return null;
    }
  }
}
