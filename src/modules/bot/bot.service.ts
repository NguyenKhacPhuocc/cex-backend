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
import { OrderSide, OrderType, OrderStatus } from 'src/shared/enums';
import { LimitOrderBotStrategy } from './strategies/limit-order-bot.strategy';
import { MarketOrderBotStrategy } from './strategies/market-order-bot.strategy';
import { TickerData, BaseStrategy } from './strategies/base-strategy';
import { Order } from '../order/entities/order.entity';

interface BotConfig {
  strategy: BaseStrategy;
  botId: string;
  symbol: string;
  lastAction: number;
  isLimitBot: boolean; // true for limit bot, false for market bot
  lastOrderTime: number; // Track when limit order was placed (for cancellation logic)
}

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  private bots: User[] = [];
  private isRunning = false;
  private botConfigs: Map<string, BotConfig> = new Map();
  private averagePrices: Map<string, number> = new Map(); // symbol -> average price from Binance
  private readonly LIMIT_BOT_PERCENTAGE = 0.7; // 70% limit bots
  // Note: MARKET_BOT_PERCENTAGE is calculated as (1 - LIMIT_BOT_PERCENTAGE) to ensure total = TOTAL_BOTS

  private get TOTAL_BOTS(): number {
    return parseInt(this.configService.get<string>('BOT_COUNT', '30'), 10);
  }

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    private readonly orderService: OrderService,
    private readonly binanceService: BinanceService,
  ) {}

  async onModuleInit() {
    const enableBots = this.configService.get<string>('ENABLE_BOTS', 'false');
    this.logger.log(`[BOT_INIT] ENABLE_BOTS=${enableBots}`);

    if (enableBots === 'true') {
      this.logger.log('[BOT_INIT]  Bots enabled, starting initialization...');
      await this.initializeBots();
      this.startTradingLoop();
      this.logger.log('[BOT_INIT]  Bot initialization complete');
    } else {
      this.logger.log('[BOT_INIT]   Bots disabled, skipping initialization');
    }
  }

  private async initializeBots(): Promise<void> {
    try {
      this.logger.log(`[BOT_INIT] Creating ${this.TOTAL_BOTS} bots...`);

      // Get active markets
      const markets = await this.marketRepo.find({
        where: { status: MarketStatus.ACTIVE },
      });

      this.logger.log(
        `[BOT_INIT] Found ${markets.length} active markets: ${markets.map((m) => m.symbol).join(', ')}`,
      );

      if (markets.length === 0) {
        this.logger.warn('[BOT_INIT] WARNING: No active markets found! Bots will not trade.');
        return;
      }

      // Create bot users
      for (let i = 1; i <= this.TOTAL_BOTS; i++) {
        const email = `bot${i}@trading.com`;
        let bot = await this.userRepo.findOne({ where: { email } });

        if (!bot) {
          bot = this.userRepo.create({
            email,
            passwordHash: 'bot_password_hash',
            role: UserRole.USER,
          });
          bot = await this.userRepo.save(bot);
          this.logger.log(`[BOT_INIT] Created bot user: ${email} (ID: ${bot.id})`);
        } else {
          this.logger.log(`[BOT_INIT] Bot user already exists: ${email} (ID: ${bot.id})`);
        }

        this.bots.push(bot);
        await this.initializeBotWalletsForMarkets(bot, markets);
      }

      // Initialize strategies for each bot-market combination
      // 70% limit bots, 30% market bots
      const limitBotCount = Math.floor(this.TOTAL_BOTS * this.LIMIT_BOT_PERCENTAGE);
      // Calculate market bot count to ensure total equals TOTAL_BOTS
      const marketBotCount = this.TOTAL_BOTS - limitBotCount;

      this.logger.log(
        `Bot distribution: ${limitBotCount} limit bots (70%), ${marketBotCount} market bots (30%)`,
      );

      for (let botIndex = 0; botIndex < this.bots.length; botIndex++) {
        const bot = this.bots[botIndex];
        const isLimitBot = botIndex < limitBotCount;

        for (const market of markets) {
          let strategy: BaseStrategy;

          if (isLimitBot) {
            strategy = new LimitOrderBotStrategy(market.symbol);
          } else {
            strategy = new MarketOrderBotStrategy(market.symbol);
          }

          // Set market info for dynamic amount calculation
          strategy.setMarketInfo({
            minOrderSize: Number(market.minOrderSize),
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
            pricePrecision: market.pricePrecision || 2, // Default 2 decimal places
          });

          const key = `${bot.id}:${market.symbol}`;
          this.botConfigs.set(key, {
            strategy,
            botId: bot.id.toString(),
            symbol: market.symbol,
            lastAction: 0,
            isLimitBot,
            lastOrderTime: 0, // Track when order was placed
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize bots:`, error);
    }
  }

  private async initializeBotWalletsForMarkets(bot: User, markets: Market[]): Promise<void> {
    const currencies = new Set<string>();
    markets.forEach((market) => {
      currencies.add(market.baseAsset);
      currencies.add(market.quoteAsset);
    });

    const initialBalances: Record<string, number> = {
      BTC: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_BTC', '10')),
      ETH: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_ETH', '20')),
      USDT: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_USDT', '500000')),
      DEFAULT: parseFloat(this.configService.get<string>('BOT_INITIAL_BALANCE_DEFAULT', '1000')),
    };

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
        wallet.balance = initialBalance;
        wallet.available = initialBalance;
        wallet.frozen = 0;
        await this.walletRepo.save(wallet);
        this.logger.debug(`Refilled wallet for bot ${bot.email}: ${currency} = ${initialBalance}`);
      }
    }
  }

  private async checkAndRefillBotWallets(): Promise<void> {
    const markets = await this.marketRepo.find({
      where: { status: MarketStatus.ACTIVE },
    });

    for (const bot of this.bots) {
      try {
        // Check if bot has frozen balance but no available balance - cancel orders to unlock
        const wallets = await this.walletRepo.find({
          where: {
            user: { id: bot.id },
            walletType: WalletType.SPOT,
          },
        });

        for (const wallet of wallets) {
          const available = Number(wallet.available);
          const frozen = Number(wallet.frozen);

          // If wallet has frozen balance but no available, try to cancel orders to unlock
          if (frozen > 0 && available === 0) {
            // Find open orders for this currency
            const currency = wallet.currency;
            const marketsForCurrency = markets.filter(
              (m) => m.baseAsset === currency || m.quoteAsset === currency,
            );

            for (const market of marketsForCurrency) {
              const openOrders = await this.orderRepo.find({
                where: {
                  user: { id: bot.id },
                  market: { id: market.id },
                  status: OrderStatus.OPEN,
                },
                relations: ['market'],
              });

              // Cancel some orders to free up balance (cancel oldest 50% or max 5 orders)
              // Hủy từng cái một với delay để tạo cảm giác realtime
              const ordersToCancel = openOrders.slice(
                0,
                Math.min(5, Math.ceil(openOrders.length / 2)),
              );
              for (const order of ordersToCancel) {
                try {
                  await this.orderService.cancelOrder(bot, order.id);
                  this.logger.log(
                    `[BOT_REFILL] Cancelled order ${order.id} to free up ${currency} for bot ${bot.email}`,
                  );
                  // Delay 1-3 giây giữa mỗi lần hủy để tạo cảm giác realtime
                  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
                } catch (error) {
                  this.logger.error(`[BOT_REFILL] Failed to cancel order ${order.id}:`, error);
                }
              }
            }
          }
        }

        await this.initializeBotWalletsForMarkets(bot, markets);
      } catch {
        // Silently fail
      }
    }
  }

  private startTradingLoop(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Main trading loop - run every 5 seconds for more realistic trading pace
    setInterval(() => {
      void this.executeBotStrategies();
    }, 5000);

    // Check and refill bot wallets periodically (every 10 seconds) - more frequent to handle frozen balance
    setInterval(() => {
      void this.checkAndRefillBotWallets();
    }, 10000);

    // Poll Binance prices periodically to update average prices
    this.listenToBinancePrices();
  }

  private listenToBinancePrices(): void {
    void this.updateBinancePrices();

    // Poll every 5 seconds to match Binance polling interval (tránh gọi quá nhiều)
    setInterval(() => {
      void this.updateBinancePrices();
    }, 3000);
  }

  private async updateBinancePrices(): Promise<void> {
    const markets = await this.marketRepo.find({
      where: { status: MarketStatus.ACTIVE },
    });

    for (const market of markets) {
      const binancePrice = await this.binanceService.getLastPrice(market.symbol);

      // Skip if price is not available (null) - will use last known price from averagePrices
      if (binancePrice === null || binancePrice <= 0 || isNaN(binancePrice)) {
        // Use existing average price if available, otherwise skip this update
        const existingPrice = this.averagePrices.get(market.symbol);
        if (existingPrice && existingPrice > 0) {
          this.logger.debug(
            `[BOT_PRICE] No new price for ${market.symbol}, keeping existing: ${existingPrice}`,
          );
          continue; // Keep using existing price, don't update
        } else {
          this.logger.warn(
            `[BOT_PRICE] No price available for ${market.symbol} and no existing price to fallback`,
          );
          continue; // Skip this market
        }
      }

      // Update average price for this symbol
      this.averagePrices.set(market.symbol, binancePrice);

      // Update all strategies with new price
      this.updateStrategies(market.symbol, binancePrice);
    }
  }

  private updateStrategies(symbol: string, price: number): void {
    const tickerData: TickerData = {
      symbol,
      price,
      timestamp: Date.now(),
    };

    for (const [, config] of this.botConfigs) {
      if (config.symbol === symbol) {
        config.strategy.onPriceUpdate(tickerData);

        // Update average price in strategy
        if (config.strategy instanceof LimitOrderBotStrategy) {
          config.strategy.setAveragePrice(price);
        } else if (config.strategy instanceof MarketOrderBotStrategy) {
          config.strategy.setAveragePrice(price);
        }
      }
    }
  }

  private async executeBotStrategies(): Promise<void> {
    const now = Date.now();
    let executedCount = 0;

    // Process bots in batches to reduce concurrent DB operations and prevent connection pool exhaustion
    const botConfigsArray = Array.from(this.botConfigs.entries());
    const BATCH_SIZE = 5; // Process 5 bots at a time to limit concurrent DB operations

    for (let i = 0; i < botConfigsArray.length; i += BATCH_SIZE) {
      const batch = botConfigsArray.slice(i, i + BATCH_SIZE);

      // Process batch with Promise.allSettled to handle errors gracefully
      const results = await Promise.allSettled(
        batch.map(async ([, config]) => {
          const interval = config.strategy.getInterval(); // 30-120 seconds for limit bots
          if (now - config.lastAction < interval) {
            return { skipped: true };
          }

          const bot = this.bots.find((b) => b.id.toString() === config.botId);
          if (!bot) {
            return { skipped: true };
          }

          try {
            const action = config.strategy.getAction();
            if (!action) {
              return { skipped: true };
            }

            // For limit bots, manage order count (3-6 orders per bot)
            if (config.isLimitBot) {
              const openOrders = await this.orderRepo.find({
                where: {
                  user: { id: bot.id },
                  market: { symbol: config.symbol },
                  status: OrderStatus.OPEN,
                  type: OrderType.LIMIT,
                },
                relations: ['market'],
                order: { createdAt: 'ASC' }, // Sort by oldest first
              });

              // Allow 3-6 limit orders per bot to fill orderbook
              const maxOrdersPerBot = Math.floor(Math.random() * 4) + 3; // 3-6 orders

              if (openOrders.length >= maxOrdersPerBot) {
                // Check if we need to cancel old orders
                const orderAge = now - config.lastOrderTime;
                const cancelInterval = Math.floor(Math.random() * 120000) + 60000; // 60-180 seconds

                if (orderAge > cancelInterval && openOrders.length > 0) {
                  // Cancel the oldest order first, then place new order
                  const oldestOrder = openOrders[0];
                  try {
                    // Cancel with timeout to prevent hanging
                    await Promise.race([
                      this.orderService.cancelOrder(bot, oldestOrder.id),
                      new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Cancel timeout')), 5000),
                      ),
                    ]);

                    // Reset lastOrderTime AFTER successful cancel
                    config.lastOrderTime = 0;

                    // Small delay to ensure orderbook is updated
                    await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 200));
                  } catch (error) {
                    // If cancel fails, log but continue (might be already cancelled or filled)
                    if (error instanceof Error && error.message !== 'Cancel timeout') {
                      this.logger.debug(
                        `[BOT_CANCEL] Order ${oldestOrder.id} might be already cancelled/filled: ${error.message}`,
                      );
                    } else {
                      this.logger.warn(
                        `[BOT_CANCEL] Failed to cancel order ${oldestOrder.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                      );
                    }
                    return { skipped: true };
                  }
                } else {
                  return { skipped: true };
                }
              }
            }

            // Validate price for limit orders before placing
            if (config.isLimitBot && action.price) {
              const currentAveragePrice = this.averagePrices.get(config.symbol);
              if (currentAveragePrice && currentAveragePrice > 0) {
                const priceDiffPercent = Math.abs(
                  (action.price - currentAveragePrice) / currentAveragePrice,
                );

                // Reject order if price deviation >2%
                if (priceDiffPercent > 0.02) {
                  this.logger.warn(
                    `[BOT_ORDER] Rejected order for ${bot.email} on ${config.symbol}: price ${action.price} deviates ${(priceDiffPercent * 100).toFixed(2)}% from current ${currentAveragePrice}`,
                  );
                  return { skipped: true };
                }
              }
            }

            this.logger.log(
              `[BOT_EXEC] Bot ${bot.email}: ${action.side} ${action.amount} @ ${action.price || 'MARKET'} (${config.isLimitBot ? 'LIMIT' : 'MARKET'}) on ${config.symbol}`,
            );

            await this.executeBotAction(bot, config.symbol, action, config.isLimitBot);

            config.lastAction = now;
            return { executed: true };
          } catch (error) {
            this.logger.error(`[BOT_EXEC] Failed to execute action for ${bot.email}:`, error);
            return { error: true };
          }
        }),
      );

      // Count executed actions
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.executed) {
          executedCount++;
        }
      }

      // Small delay between batches to reduce DB load and prevent connection pool exhaustion
      if (i + BATCH_SIZE < botConfigsArray.length) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    if (executedCount > 0) {
      this.logger.debug(`[BOT_EXEC] Executed ${executedCount} bot actions`);
    }
  }

  private async executeBotAction(
    bot: User,
    symbol: string,
    action: { side: OrderSide; price: number; amount: number },
    isLimitBot: boolean,
  ): Promise<void> {
    if (!action) return;

    try {
      const market = await this.marketRepo.findOne({
        where: { symbol },
      });

      if (!market) {
        this.logger.warn(`[BOT_ACTION] Market not found: ${symbol}`);
        return;
      }

      const createOrderDto: CreateOrderDto = {
        marketSymbol: market.symbol,
        side: action.side,
        type: isLimitBot ? OrderType.LIMIT : OrderType.MARKET,
        price: isLimitBot ? action.price : undefined, // Market orders don't need price
        amount: action.amount,
      };

      const order = await this.orderService.createOrder(bot, createOrderDto);

      // Track when limit order was placed (for cancellation logic)
      if (isLimitBot) {
        const configKey = Array.from(this.botConfigs.keys()).find(
          (key) =>
            this.botConfigs.get(key)?.botId === bot.id.toString() &&
            this.botConfigs.get(key)?.symbol === symbol,
        );
        if (configKey) {
          const config = this.botConfigs.get(configKey);
          if (config) {
            config.lastOrderTime = Date.now();
          }
        }
      }

      this.logger.log(`[BOT_ORDER] Order created successfully for ${bot.email}: ${order.id}`);
    } catch (error) {
      this.logger.error(`[BOT_ORDER] Failed to create order:`, error);
    }
  }
}
