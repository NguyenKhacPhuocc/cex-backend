import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from 'src/core/redis/redis.service';
import { Market, MarketStatus } from '../market/entities/market.entity';
import axios from 'axios';

interface BinanceTickerResponse {
  symbol: string;
  price: string;
}

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private priceUpdateInterval: NodeJS.Timeout | null = null;

  // Binance symbol to internal symbol mapping
  private symbolMap: Map<string, string> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
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

  private async initializeSymbolMapping(): Promise<void> {
    try {
      const markets = await this.marketRepo.find({
        where: { status: MarketStatus.ACTIVE },
      });

      for (const market of markets) {
        // Convert internal symbol (BTC_USDT) to Binance symbol (BTCUSDT)
        const binanceSymbol = market.symbol.replace('_', '').toLowerCase();
        this.symbolMap.set(binanceSymbol, market.symbol);
      }

      this.logger.log(`Initialized ${this.symbolMap.size} trading pairs from database`);
    } catch (error) {
      this.logger.error(`Failed to initialize symbol mapping: ${(error as Error).message}`);
    }
  }

  private startPricePolling(): void {
    // Fetch prices immediately
    void this.fetchPrices();

    // Then poll every 1 second
    this.priceUpdateInterval = setInterval(() => {
      void this.fetchPrices();
    }, 1000);
  }

  private stopPricePolling(): void {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
  }

  private async fetchPrices(): Promise<void> {
    try {
      // Fetch all ticker prices from Binance REST API (individual calls for simplicity)
      for (const binanceSymbol of this.symbolMap.keys()) {
        try {
          const url = `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol.toUpperCase()}`;
          const response = await axios.get<BinanceTickerResponse>(url);

          const internalSymbol = this.symbolMap.get(binanceSymbol.toLowerCase());

          if (!internalSymbol) {
            continue;
          }

          const price = parseFloat(response.data.price);

          // Store in Redis
          await this.redisService.set(`binance:price:${internalSymbol}`, price.toString(), 10); // 10 seconds TTL
        } catch (error) {
          this.logger.error(
            `Failed to fetch price for ${binanceSymbol}: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch Binance prices: ${(error as Error).message}`);
    }
  }

  /**
   * Get last price from Redis cache
   */
  async getLastPrice(symbol: string): Promise<number | null> {
    try {
      const cached = await this.redisService.get(`binance:price:${symbol}`);
      return cached ? parseFloat(cached) : null;
    } catch (error) {
      this.logger.error(`Failed to get last price from cache: ${(error as Error).message}`);
      return null;
    }
  }
}
