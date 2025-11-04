import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/entities/user.entity';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { Market, MarketStatus } from '../market/entities/market.entity';
import { OrderService } from '../order/order.service';
import { BinanceService } from '../binance/binance.service';
import { CreateOrderDto } from '../order/dtos/create-order.dto';
import { OrderSide, OrderType } from 'src/shared/enums';
import { MarketMakerStrategy } from './strategies/market-maker.strategy';
import { TrendFollowerStrategy } from './strategies/trend-follower.strategy';
import { RandomTraderStrategy } from './strategies/random-trader.strategy';
import { TickerData, BaseStrategy } from './strategies/base-strategy';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bots: User[] = [];
  private isRunning = false;
  private strategies: Map<
    string,
    { strategy: BaseStrategy; botId: string; symbol: string; lastAction: number }
  > = new Map();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
    private readonly orderService: OrderService,
    private readonly binanceService: BinanceService,
  ) {}

  async onModuleInit() {
    const enableBots = this.configService.get<string>('ENABLE_BOTS', 'true');
    this.logger.log(`[BOT_INIT] ENABLE_BOTS=${enableBots}`);

    if (enableBots === 'true') {
      this.logger.log('[BOT_INIT] ✅ Bots enabled, starting initialization...');
      await this.initializeBots();
      this.startTradingLoop();
      this.logger.log('[BOT_INIT] ✅ Bot initialization complete');
    } else {
      this.logger.log('[BOT_INIT] ❌ Bots disabled, skipping initialization');
    }
  }

  private async initializeBots(): Promise<void> {
    try {
      // Configuration from environment
      const botCount = parseInt(this.configService.get<string>('BOT_COUNT', '5'));
      this.logger.log(`[BOT_INIT] Creating ${botCount} bots...`);

      // Get active markets FIRST
      const markets = await this.marketRepo.find({
        where: { status: MarketStatus.ACTIVE },
      });

      this.logger.log(
        `[BOT_INIT] Found ${markets.length} active markets: ${markets.map((m) => m.symbol).join(', ')}`,
      );

      if (markets.length === 0) {
        this.logger.warn('[BOT_INIT] ⚠️ WARNING: No active markets found! Bots will not trade.');
      }

      // Get or create bot users
      for (let i = 1; i <= botCount; i++) {
        const email = `bot${i}@trading.com`;
        let bot = await this.userRepo.findOne({ where: { email } });

        if (!bot) {
          // Create bot user
          bot = this.userRepo.create({
            email,
            passwordHash: 'bot_password_hash', // Bot doesn't need real password
            role: UserRole.USER,
          });
          bot = await this.userRepo.save(bot);
          this.logger.log(`[BOT_INIT] ✅ Created bot user: ${email} (ID: ${bot.id})`);
        } else {
          this.logger.log(`[BOT_INIT] ⏭️ Bot user already exists: ${email} (ID: ${bot.id})`);
        }

        this.bots.push(bot);

        // Initialize wallets for bot for ALL markets
        await this.initializeBotWalletsForMarkets(bot, markets);
      }

      // Initialize strategies for each bot-market combination
      for (const bot of this.bots) {
        for (const market of markets) {
          // Assign different strategies to different bots
          const botIndex = this.bots.indexOf(bot);
          let strategy: BaseStrategy;

          if (botIndex % 3 === 0) {
            // Market Maker bot - small spread for higher match rate
            strategy = new MarketMakerStrategy(market.symbol, 0.001); // 0.1% spread
            this.strategies.set(`${bot.id}:${market.symbol}:mm`, {
              strategy,
              botId: bot.id.toString(),
              symbol: market.symbol,
              lastAction: 0,
            });
            this.logger.debug(
              `[BOT_STRATEGY] Assigned MarketMaker strategy to bot${botIndex + 1} for ${market.symbol}`,
            );
          } else if (botIndex % 3 === 1) {
            // Trend Follower bot
            strategy = new TrendFollowerStrategy(market.symbol);
            this.strategies.set(`${bot.id}:${market.symbol}:tf`, {
              strategy,
              botId: bot.id.toString(),
              symbol: market.symbol,
              lastAction: 0,
            });
            this.logger.debug(
              `[BOT_STRATEGY] Assigned TrendFollower strategy to bot${botIndex + 1} for ${market.symbol}`,
            );
          } else {
            // Random Trader bot
            strategy = new RandomTraderStrategy(market.symbol);
            this.strategies.set(`${bot.id}:${market.symbol}:rt`, {
              strategy,
              botId: bot.id.toString(),
              symbol: market.symbol,
              lastAction: 0,
            });
            this.logger.debug(
              `[BOT_STRATEGY] Assigned RandomTrader strategy to bot${botIndex + 1} for ${market.symbol}`,
            );
          }

          // Set market info for dynamic amount calculation
          strategy.setMarketInfo({
            minOrderSize: Number(market.minOrderSize),
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
          });
        }
      }

      this.logger.log(
        `[BOT_INIT] ✅ Initialized ${this.bots.length} bots with ${this.strategies.size} strategy instances`,
      );
    } catch (error) {
      this.logger.error(`[BOT_INIT] ❌ Failed to initialize bots:`, error);
      // Silently fail - initialization errors are not critical
    }
  }

  private async initializeBotWalletsForMarkets(bot: User, markets: Market[]): Promise<void> {
    // Collect unique currencies from all markets
    const currencies = new Set<string>();
    markets.forEach((market) => {
      currencies.add(market.baseAsset);
      currencies.add(market.quoteAsset);
    });

    // Configuration for each currency with default values
    const initialBalances: Record<string, number> = {
      BTC: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_BTC', '10')),
      ETH: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_ETH', '20')),
      USDT: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_USDT', '500000')),
      // Default for other currencies
      DEFAULT: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_DEFAULT', '1000')),
    };

    // Initialize wallet for each currency
    for (const currency of currencies) {
      const initialBalance = initialBalances[currency] || initialBalances.DEFAULT;

      let wallet = await this.walletRepo.findOne({
        where: {
          user: { id: bot.id },
          currency: currency,
          walletType: WalletType.SPOT,
        },
      });

      if (!wallet) {
        wallet = this.walletRepo.create({
          user: bot,
          currency: currency,
          balance: initialBalance,
          available: initialBalance,
          frozen: 0,
          walletType: WalletType.SPOT,
        });
        await this.walletRepo.save(wallet);
        this.logger.debug(`Created wallet for bot ${bot.email}: ${currency} = ${initialBalance}`);
      } else if (Number(wallet.balance) < initialBalance) {
        // Refill if balance is low
        wallet.balance = initialBalance;
        wallet.available = initialBalance;
        wallet.frozen = 0;
        await this.walletRepo.save(wallet);
        this.logger.debug(`Refilled wallet for bot ${bot.email}: ${currency} = ${initialBalance}`);
      }
    }
  }

  // Check and refill bot wallets if balance is low
  // This ensures bots can continue trading even if they run out of funds
  private async checkAndRefillBotWallets(): Promise<void> {
    const markets = await this.marketRepo.find({
      where: { status: MarketStatus.ACTIVE },
    });

    for (const bot of this.bots) {
      try {
        await this.initializeBotWalletsForMarkets(bot, markets);
      } catch {
        // Silently fail - continue with other bots
      }
    }
  }

  private startTradingLoop(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.logger.log(`[BOT_LOOP] 🚀 Starting trading loop with ${this.bots.length} bots...`);

    // Main trading loop - run every 1 second
    setInterval(() => {
      void this.executeBotStrategies();
    }, 1000);

    // Check and refill bot wallets periodically (every 30 seconds)
    // This ensures bots always have enough balance to continue trading
    setInterval(() => {
      void this.checkAndRefillBotWallets();
    }, 30000);

    // Poll Binance prices periodically
    this.listenToBinancePrices();
    this.logger.log('[BOT_LOOP] ✅ Trading loop started');
  }

  private listenToBinancePrices(): void {
    this.logger.log('[BOT_PRICE] 📡 Starting Binance price listener...');
    // Poll Binance prices every 1 second to closely follow market
    // Immediate update on start
    void this.updateBinancePrices();

    // Then poll every 1 second
    setInterval(() => {
      void this.updateBinancePrices();
    }, 1000);
  }

  private async updateBinancePrices(): Promise<void> {
    const markets = await this.marketRepo.find({
      where: { status: MarketStatus.ACTIVE },
    });

    let priceUpdates = 0;
    for (const market of markets) {
      const binancePrice = await this.binanceService.getLastPrice(market.symbol);

      if (binancePrice) {
        // Update strategies with new price
        this.updateStrategies(market.symbol, binancePrice);
        priceUpdates++;
      } else {
        this.logger.warn(`[BOT_PRICE] ⚠️ No price found for ${market.symbol}`);
      }
    }

    if (priceUpdates > 0) {
      this.logger.debug(`[BOT_PRICE] Updated prices for ${priceUpdates}/${markets.length} markets`);
    }
  }

  private updateStrategies(symbol: string, price: number): void {
    const tickerData: TickerData = {
      symbol,
      price,
      timestamp: Date.now(),
    };

    for (const [key, { strategy }] of this.strategies) {
      if (key.includes(symbol)) {
        strategy.onPriceUpdate(tickerData);
      }
    }
  }

  private async executeBotStrategies(): Promise<void> {
    const now = Date.now();
    let executedCount = 0;

    for (const [key, { strategy, botId, symbol, lastAction }] of this.strategies) {
      const interval = strategy.getInterval();
      if (now - lastAction < interval * 1000) continue;

      const bot = this.bots.find((b) => b.id.toString() === botId);
      if (!bot) continue;

      try {
        const action = strategy.getAction();
        if (!action) continue;

        this.logger.log(
          `[BOT_EXEC] Bot ${bot.email}: ${action.side} ${action.amount} @ ${action.price} on ${symbol}`,
        );

        await this.executeBotAction(bot, symbol, action);
        executedCount++;

        // Update last action time
        const config = this.strategies.get(key);
        if (config) {
          config.lastAction = now;
        }
      } catch (error) {
        this.logger.error(`[BOT_EXEC] ❌ Failed to execute action for ${bot.email}:`, error);
        // Silently fail - bots should continue running even if one action fails
      }
    }

    if (executedCount > 0) {
      this.logger.log(`[BOT_EXEC] ✅ Executed ${executedCount} bot actions`);
    }
  }

  private async executeBotAction(
    bot: User,
    symbol: string,
    action: { side: OrderSide; price: number; amount: number },
  ): Promise<void> {
    if (!action) return;

    try {
      // Get market for this symbol
      const market = await this.marketRepo.findOne({
        where: { symbol },
      });

      if (!market) {
        this.logger.warn(`[BOT_ACTION] ⚠️ Market not found: ${symbol}`);
        return;
      }

      // Get the latest Binance price right before placing order to ensure accuracy
      // This prevents using stale prices that may have changed
      const latestBinancePrice = await this.binanceService.getLastPrice(symbol);

      // Use latest Binance price if available and update strategy, otherwise use action.price
      let finalPrice = action.price;
      if (latestBinancePrice && latestBinancePrice > 0) {
        // Update the strategy with latest price first
        this.updateStrategies(symbol, latestBinancePrice);

        // Find strategy for this bot and symbol
        const strategyKey = Array.from(this.strategies.keys()).find(
          (key) => key.includes(symbol) && this.strategies.get(key)?.botId === bot.id.toString(),
        );

        if (strategyKey) {
          const { strategy } = this.strategies.get(strategyKey)!;
          const updatedAction = strategy.getAction();
          if (updatedAction) {
            finalPrice = updatedAction.price;
          } else {
            // If strategy returns null, use latest Binance price directly
            finalPrice = latestBinancePrice;
          }
        } else {
          // Fallback: use latest Binance price directly
          finalPrice = latestBinancePrice;
        }
      }

      const createOrderDto: CreateOrderDto = {
        marketSymbol: market.symbol,
        side: action.side,
        type: OrderType.LIMIT,
        price: finalPrice,
        amount: action.amount,
      };

      this.logger.log(
        `[BOT_ORDER] 📝 Creating order for ${bot.email}: ${JSON.stringify(createOrderDto)}`,
      );
      await this.orderService.createOrder(bot, createOrderDto);
      this.logger.log(`[BOT_ORDER] ✅ Order created successfully for ${bot.email}`);
    } catch (error) {
      this.logger.error(`[BOT_ORDER] ❌ Failed to create order:`, error);
      // Silently fail - bots should continue running even if one order fails
    }
  }
}
