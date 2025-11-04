import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from 'src/core/redis/redis.service';
import { Market, MarketStatus } from '../market/entities/market.entity';
import WebSocket from 'ws';

interface BinanceTickerData {
  c: string; // Last price
  p: string; // Price change
  P: string; // Price change percent
}

@Injectable()
export class BinanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private ws: WebSocket | null = null;
  private wsReconnectInterval: NodeJS.Timeout | null = null;
  private throttleInterval: NodeJS.Timeout | null = null; // flush prices every 1s
  private provider: 'binance' | 'coincap' = 'binance';

  // Binance symbol -> internal symbol mapping
  // Example: "BTCUSDT" -> "BTC_USDT"
  private binanceSymbolMap: Map<string, string> = new Map();
  private latestPrices: Map<string, number> = new Map(); // internal symbol -> last price
  private assetToInternalMap: Map<string, string> = new Map(); // BASE -> BASE_USDT

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
  ) {}

  async onModuleInit() {
    const enabled = this.configService.get<string>('BINANCE_ENABLED', 'true');
    const configuredProvider = (
      this.configService.get<string>('PRICE_PROVIDER', 'coincap') || 'coincap'
    ).toLowerCase();
    this.provider = configuredProvider === 'binance' ? 'binance' : 'coincap';

    if (enabled === 'true') {
      await this.initializeSymbolMapping();
      this.connectWebSocket();
    }
  }

  onModuleDestroy() {
    this.disconnectWebSocket();
    this.stopThrottleFlush();
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
          // Binance mapping (BINANCE: BTCUSDT -> BTC_USDT)
          const binanceSymbol = `${baseAsset}USDT`;
          this.binanceSymbolMap.set(binanceSymbol, symbol);

          // Generic asset -> internal mapping for CoinCap (BASE -> BASE_USDT)
          this.assetToInternalMap.set(baseAsset, symbol);

          // Log for debugging
          this.logger.debug(`Mapped: ${symbol} (${baseAsset}/${quoteAsset}) -> ${binanceSymbol}`);
        } else {
          this.logger.debug(`Skipping ${symbol}: quoteAsset ${quoteAsset} is not USDT`);
        }
      }

      this.logger.log(`Initialized ${this.binanceSymbolMap.size} trading pairs from database`);
    } catch (error) {
      this.logger.error(`Failed to initialize symbol mapping: ${(error as Error).message}`);
    }
  }

  private connectWebSocket(): void {
    try {
      // Choose provider
      if (this.provider === 'coincap') {
        // CoinCap WebSocket (free, stable): all assets in one stream
        const wsUrl = 'wss://ws.coincap.io/prices?assets=ALL';
        this.logger.log('Connecting to CoinCap WebSocket...');
        this.ws = new WebSocket(wsUrl);
      } else {
        if (this.binanceSymbolMap.size === 0) {
          this.logger.warn('No symbols to subscribe');
          return;
        }
        // Binance combined stream
        const streams = Array.from(this.binanceSymbolMap.keys())
          .map((symbol) => `${symbol.toLowerCase()}@ticker`)
          .join('/');

        const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
        this.logger.log(
          `Connecting to Binance WebSocket for ${this.binanceSymbolMap.size} symbols...`,
        );
        this.ws = new WebSocket(wsUrl);
      }

      this.ws.on('open', () => {
        this.logger.log('✅ Binance WebSocket connected');
        this.clearReconnectInterval();
      });

      this.ws.on('message', (wsData: WebSocket.Data) => {
        try {
          let dataString: string;
          if (typeof wsData === 'string') {
            dataString = wsData;
          } else if (Buffer.isBuffer(wsData)) {
            dataString = wsData.toString('utf8');
          } else {
            // Fallback: convert to string (should not happen with Binance WebSocket)
            this.logger.warn('Unexpected WebSocket data type, skipping');
            return;
          }

          if (this.provider === 'coincap') {
            // CoinCap format: { "bitcoin": "68000.12", "ethereum": "3500.99", ... }
            const prices = JSON.parse(dataString) as Record<string, string>;
            this.processCoinCapPrices(prices);
          } else {
            const message = JSON.parse(dataString) as {
              stream?: string;
              data?: BinanceTickerData;
            };
            if (message.stream && message.data) {
              this.processBinanceWebSocketPrice(message.stream, message.data);
            }
          }
        } catch (error) {
          this.logger.error(`Failed to parse WebSocket message: ${(error as Error).message}`);
        }
      });

      this.ws.on('error', (error) => {
        this.logger.error(`WebSocket error: ${error.message}`);
      });

      this.ws.on('close', () => {
        this.logger.warn('WebSocket connection closed, will reconnect...');
        this.scheduleReconnect();
      });

      // Start throttled flush (1s) after WS is connected
      this.startThrottleFlush();
    } catch (error) {
      this.logger.error(`Failed to connect Binance WebSocket: ${(error as Error).message}`);
    }
  }

  private processBinanceWebSocketPrice(stream: string, data: BinanceTickerData): void {
    try {
      // Extract symbol from stream: "btcusdt@ticker" -> "BTCUSDT"
      const binanceSymbol = stream.split('@')[0].toUpperCase();

      if (!this.binanceSymbolMap.has(binanceSymbol)) {
        // Symbol not in our mapping - might be a market we don't support
        this.logger.debug(`Ignoring price update for unmapped symbol: ${binanceSymbol}`);
        return;
      }

      // Get internal symbol from database format: "BTC_USDT"
      const internalSymbol = this.binanceSymbolMap.get(binanceSymbol)!;

      // Binance ticker data: { c: "68000", ... } where 'c' is the last price
      const price = parseFloat(data.c || '0');

      if (price > 0) {
        // Buffer latest price; a separate interval flushes to Redis every 1s
        this.latestPrices.set(internalSymbol, price);
      } else {
        this.logger.warn(`Invalid price received for ${internalSymbol}: ${data.c}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process Binance WebSocket price: ${(error as Error).message}`);
    }
  }

  private processCoinCapPrices(prices: Record<string, string>): void {
    // CoinCap IDs to base assets mapping
    const idToAsset: Record<string, string> = {
      bitcoin: 'BTC',
      ethereum: 'ETH',
      solana: 'SOL',
      'binance-coin': 'BNB',
      dogecoin: 'DOGE',
      'shiba-inu': 'SHIB',
      ripple: 'XRP',
      cardano: 'ADA',
      avalanche: 'AVAX',
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
    };

    for (const [id, priceStr] of Object.entries(prices)) {
      const asset = idToAsset[id.toLowerCase()];
      if (!asset) continue;
      const internalSymbol = this.assetToInternalMap.get(asset);
      if (!internalSymbol) continue;
      const price = parseFloat(priceStr);
      if (!(price > 0)) continue;
      // Buffer latest price (throttled flush will write to Redis)
      this.latestPrices.set(internalSymbol, price);
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectInterval();
    // Reconnect after 5 seconds
    this.wsReconnectInterval = setTimeout(() => {
      this.logger.log('Attempting to reconnect WebSocket...');
      this.connectWebSocket();
    }, 5000);
  }

  private clearReconnectInterval(): void {
    if (this.wsReconnectInterval) {
      clearTimeout(this.wsReconnectInterval);
      this.wsReconnectInterval = null;
    }
  }

  private disconnectWebSocket(): void {
    this.clearReconnectInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Flush buffered prices to Redis every 1 second (throttling)
   */
  private startThrottleFlush(): void {
    this.stopThrottleFlush();
    this.throttleInterval = setInterval(() => {
      if (this.latestPrices.size === 0) return;
      // Snapshot to avoid long lock
      const entries = Array.from(this.latestPrices.entries());
      // Clear map to accept fresh updates while flushing
      this.latestPrices.clear();
      // Write all latest prices to Redis
      for (const [internalSymbol, price] of entries) {
        void this.redisService.set(`binance:price:${internalSymbol}`, String(price), 3); // short TTL
      }
    }, 1000);
  }

  private stopThrottleFlush(): void {
    if (this.throttleInterval) {
      clearInterval(this.throttleInterval);
      this.throttleInterval = null;
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
