import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { RedisService } from 'src/core/redis/redis.service';
import { Market, MarketStatus } from '../market/entities/market.entity';

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private pricePollingInterval: NodeJS.Timeout | null = null;
  private provider: 'binance' | 'coincap' = 'coincap';

  // Binance symbol -> internal symbol mapping
  // Example: "BTCUSDT" -> "BTC_USDT"
  private assetToInternalMap: Map<string, string> = new Map(); // BASE -> BASE_USDT
  private latestPrices: Map<string, number> = new Map(); // internal symbol -> last price

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get<string>('BINANCE_ENABLED', 'true');
    this.provider = 'coincap'; // Force use CoinCap REST API (free, no auth needed)

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
        // Database format: symbol="BTC_USDT", baseAsset="BTC", quoteAsset="USDT"
        const baseAsset = market.baseAsset?.toUpperCase().trim();
        const quoteAsset = market.quoteAsset?.toUpperCase().trim();
        const symbol = market.symbol?.toUpperCase().trim();

        // Validate format
        if (!baseAsset || !quoteAsset || !symbol) {
          this.logger.warn(`Invalid market data: ${JSON.stringify(market)}`);
          continue;
        }

        // Verify symbol format matches: BASE_QUOTE
        const expectedSymbol = `${baseAsset}_${quoteAsset}`;
        if (symbol !== expectedSymbol) {
          this.logger.warn(
            `Symbol mismatch: expected ${expectedSymbol}, got ${symbol}. Using baseAsset/quoteAsset instead.`,
          );
        }

        // Only support USDT pairs
        if (quoteAsset === 'USDT') {
          // Generic asset -> internal mapping for CoinCap (BASE -> BASE_USDT)
          this.assetToInternalMap.set(baseAsset, symbol);

          // Log for debugging
          this.logger.debug(`Mapped: ${symbol} (${baseAsset}/${quoteAsset})`);
        }
      }

      const mapSize = this.assetToInternalMap.size;
      this.logger.log(`Initialized ${mapSize} trading pairs from database`);
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`Failed to initialize symbol mapping: ${msg}`);
    }
  }

  /**
   * Start polling CoinCap REST API instead of WebSocket
   * CoinCap REST API is FREE and doesn't require authentication
   */
  private startPricePolling(): void {
    this.logger.log('[PRICE_POLLING] 🚀 Starting CoinCap REST API polling...');

    // Fetch immediately
    void this.fetchPricesFromCoinCap();

    // Then poll every 2 seconds (CoinCap updates every 1-2 seconds anyway)
    this.pricePollingInterval = setInterval(() => {
      void this.fetchPricesFromCoinCap();
    }, 2000);

    this.logger.log('[PRICE_POLLING] ✅ Price polling started (2s interval)');
  }

  private stopPricePolling(): void {
    if (this.pricePollingInterval) {
      clearInterval(this.pricePollingInterval);
      this.pricePollingInterval = null;
    }
  }

  /**
   * Fetch prices from CoinCap REST API (FREE - no auth required)
   * API Docs: https://docs.coincap.io/
   */
  private async fetchPricesFromCoinCap(): Promise<void> {
    try {
      // Get list of assets we need (BTC, ETH, SOL, etc.)
      const assetsNeeded = Array.from(this.assetToInternalMap.keys()).join(',');

      if (!assetsNeeded) {
        return; // No markets to fetch
      }

      // CoinCap REST API: Get current prices for specific assets
      // Format: /v2/assets?ids=bitcoin,ethereum,solana
      const assetIds = this.getAssetIdsToCoinCapIds(assetsNeeded);
      const url = `https://api.coincap.io/v2/assets?ids=${assetIds}`;

      this.logger.debug(`[COINCAP_API] 📡 Fetching from: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      });

      if (response.status !== 200) {
        const status = response.status;
        const statusText = response.statusText;
        this.logger.error(`[COINCAP_API] ❌ HTTP Error ${status}: ${statusText}`);
        return;
      }

      const data = response.data as {
        data?: Array<{ id: string; priceUsd: string }>;
      };

      if (!data.data || data.data.length === 0) {
        this.logger.warn('[COINCAP_API] ⚠️ No price data received');
        return;
      }

      // Process prices
      this.processCoinCapRestPrices(data.data);
      this.flushPricesToRedis();
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`[COINCAP_API] ❌ Failed to fetch prices: ${msg}`);
      if (error instanceof axios.AxiosError) {
        this.logger.debug(`[COINCAP_API] Error Code: ${error.code}`);
        this.logger.debug(`[COINCAP_API] Status: ${error.response?.status}`);
        this.logger.debug(`[COINCAP_API] URL: ${error.config?.url}`);
      }
    }
  }

  /**
   * Convert asset symbols to CoinCap IDs
   * Example: BTC -> bitcoin, ETH -> ethereum
   */
  private getAssetIdsToCoinCapIds(assetsStr: string): string {
    const assetToIdMap: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SOL: 'solana',
      BNB: 'binance-coin',
      DOGE: 'dogecoin',
      SHIB: 'shiba-inu',
      XRP: 'ripple',
      ADA: 'cardano',
      AVAX: 'avalanche-2',
      DOT: 'polkadot',
      MATIC: 'matic-network',
      LTC: 'litecoin',
      UNI: 'uniswap',
      LINK: 'chainlink',
      ATOM: 'cosmos',
      ETC: 'ethereum-classic',
      XLM: 'stellar',
      ALGO: 'algorand',
      VET: 'vechain',
      FIL: 'filecoin',
      TRX: 'tron',
      TAO: 'bittensor',
      TON: 'the-open-network',
      PEPE: 'pepe',
    };

    const assets = assetsStr.split(',');
    return assets.map((asset) => assetToIdMap[asset.trim()] || asset.toLowerCase()).join(',');
  }

  /**
   * Process prices from CoinCap REST API response
   */
  private processCoinCapRestPrices(assets: Array<{ id: string; priceUsd: string }>): void {
    const idToAsset: Record<string, string> = {
      bitcoin: 'BTC',
      ethereum: 'ETH',
      solana: 'SOL',
      'binance-coin': 'BNB',
      dogecoin: 'DOGE',
      'shiba-inu': 'SHIB',
      ripple: 'XRP',
      cardano: 'ADA',
      'avalanche-2': 'AVAX',
      polkadot: 'DOT',
      'matic-network': 'MATIC',
      litecoin: 'LTC',
      uniswap: 'UNI',
      chainlink: 'LINK',
      cosmos: 'ATOM',
      'ethereum-classic': 'ETC',
      stellar: 'XLM',
      algorand: 'ALGO',
      vechain: 'VET',
      filecoin: 'FIL',
      tron: 'TRX',
      bittensor: 'TAO',
      'the-open-network': 'TON',
      pepe: 'PEPE',
    };

    const processedPrices: string[] = [];

    for (const asset of assets) {
      const assetSymbol = idToAsset[asset.id.toLowerCase()];
      if (!assetSymbol) continue;

      const internalSymbol = this.assetToInternalMap.get(assetSymbol);
      if (!internalSymbol) continue;

      const price = parseFloat(asset.priceUsd);
      if (!(price > 0)) continue;

      this.latestPrices.set(internalSymbol, price);
      processedPrices.push(`${internalSymbol}=${price.toFixed(2)}`);
    }

    if (processedPrices.length > 0) {
      const msg = processedPrices.join(', ');
      this.logger.log(`[COINCAP_PRICES] 💰 Prices: ${msg}`);
    }
  }

  /**
   * Flush buffered prices to Redis
   */
  private flushPricesToRedis(): void {
    if (this.latestPrices.size === 0) return;

    const entries = Array.from(this.latestPrices.entries());
    this.latestPrices.clear();

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
   * Get last price from Redis cache
   */
  async getLastPrice(symbol: string): Promise<number | null> {
    try {
      const cached = await this.redisService.get(`binance:price:${symbol}`);
      if (cached) {
        const price = parseFloat(cached);
        const msg = `Retrieved ${symbol} from Redis: ${price}`;
        this.logger.debug(`[REDIS_GET] 📖 ${msg}`);
        return price;
      }
      this.logger.warn(`[REDIS_GET] ⚠️ No price in Redis for ${symbol}`);
      return null;
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`Failed to get last price from cache: ${msg}`);
      return null;
    }
  }
}
