import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis/redis.service';
import axios from 'axios';

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private pricePollingInterval: NodeJS.Timeout | null = null;
  private assetToInternalMap: Map<string, string> = new Map();
  private latestPrices: Map<string, number> = new Map();

  constructor(
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get<string>('BINANCE_ENABLED', 'true');
    if (enabled === 'true') {
      await this.initializeSymbolMapping();
      this.startPricePolling();
    }
  }

  onModuleDestroy() {
    this.stopPricePolling();
  }

  /**
   * Initialize mapping from Binance symbols to internal symbols
   */
  private async initializeSymbolMapping(): Promise<void> {
    // Map Binance symbols to internal symbols
    const mapping: Record<string, string> = {
      BTCUSDT: 'BTC_USDT',
      ETHUSDT: 'ETH_USDT',
      SOLUSDT: 'SOL_USDT',
    };

    for (const [binanceSymbol, internalSymbol] of Object.entries(mapping)) {
      this.assetToInternalMap.set(binanceSymbol, internalSymbol);
    }

    this.logger.log('[BINANCE_INIT] ✅ Symbol mapping initialized');
  }

  /**
   * Start polling Binance Public API for prices
   * Binance API is free, public, no authentication required
   * Using ticker/24hr endpoint which is fast and reliable
   */
  private startPricePolling(): void {
    this.logger.log('[PRICE_POLLING] 🚀 Starting Binance Public API polling...');

    // Initial fetch
    void this.fetchPricesFromBinance();

    // Poll every 2 seconds
    this.pricePollingInterval = setInterval(() => {
      void this.fetchPricesFromBinance();
    }, 2000);

    this.logger.log('[PRICE_POLLING] ✅ Price polling started (2s interval)');
  }

  private stopPricePolling(): void {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
      this.logger.log('[PRICE_POLLING] ⛔ Price polling stopped');
    }
  }

  /**
   * Fetch prices from Binance Public API
   * Binance 24hr ticker endpoint returns current price and 24h data
   * No API key required, free tier allows thousands of requests per minute
   */
  private async fetchPricesFromBinance(): Promise<void> {
    try {
      // Get symbols we need to fetch
      const symbolsNeeded = Array.from(this.assetToInternalMap.keys());
      if (symbolsNeeded.length === 0) return;

      const prices: Map<string, number> = new Map();

      // Fetch prices for each symbol from Binance
      for (const binanceSymbol of symbolsNeeded) {
        try {
          const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${binanceSymbol}`;
          this.logger.debug(`[BINANCE_API] 📡 Fetching from: ${url}`);

          const response = await axios.get(url, { timeout: 5000 });

          if (response.status !== 200) {
            this.logger.error(
              `[BINANCE_API] ❌ HTTP Error ${response.status}: ${response.statusText}`,
            );
            continue;
          }

          const data = response.data as { symbol: string; lastPrice: string };
          if (!data.lastPrice) {
            this.logger.warn(`[BINANCE_API] ⚠️ No price data in response for ${binanceSymbol}`);
            continue;
          }

          const price = parseFloat(data.lastPrice);
          if (isNaN(price) || price <= 0) {
            this.logger.warn(
              `[BINANCE_API] ⚠️ Invalid price for ${binanceSymbol}: ${data.lastPrice}`,
            );
            continue;
          }

          prices.set(binanceSymbol, price);
        } catch (error) {
          const msg = (error as Error).message;
          this.logger.error(`[BINANCE_API] ❌ Failed to fetch ${binanceSymbol}: ${msg}`);
          if (error instanceof axios.AxiosError) {
            this.logger.debug(`[BINANCE_API] Error Code: ${error.code}`);
            this.logger.debug(`[BINANCE_API] Status: ${error.response?.status}`);
          }
        }
      }

      // Process prices and update Redis
      if (prices.size > 0) {
        this.processBinancePrices(prices);
        this.flushPricesToRedis();
      }
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[BINANCE_API] ❌ Unexpected error fetching prices: ${msg}`);
    }
  }

  /**
   * Process Binance prices and map to internal symbols
   */
  private processBinancePrices(prices: Map<string, number>): void {
    const processedPrices: string[] = [];

    for (const [binanceSymbol, price] of prices) {
      const internalSymbol = this.assetToInternalMap.get(binanceSymbol);
      if (!internalSymbol) continue;

      this.latestPrices.set(internalSymbol, price);
      processedPrices.push(`${internalSymbol}=${price.toFixed(2)}`);
    }

    if (processedPrices.length > 0) {
      const msg = processedPrices.join(', ');
      this.logger.log(`[BINANCE_PRICES] 💰 Prices: ${msg}`);
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
    this.logger.log(`[REDIS_FLUSH] 💾 Saved to Redis: ${msg}`);
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
        this.logger.debug(`[REDIS_GET] 📖 Retrieved ${symbol} from Redis: ${price}`);
        return price;
      }

      this.logger.warn(`[REDIS_GET] ⚠️ No price in Redis for ${symbol}`);
      return null;
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[REDIS_GET] ❌ Failed to get price: ${msg}`);
      return null;
    }
  }
}
