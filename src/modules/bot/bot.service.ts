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
      this.logger.log(`[BOT_INIT] Creating ${this.TOTAL_BOTS} bots...`);

      // Get active markets
      const markets = await this.marketRepo.find({
        where: { status: MarketStatus.ACTIVE },
      });

      this.logger.log(
        `[BOT_INIT] Found ${markets.length} active markets: ${markets.map((m) => m.symbol).join(', ')}`,
      );

      if (markets.length === 0) {
        this.logger.warn('[BOT_INIT] ⚠️ WARNING: No active markets found! Bots will not trade.');
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
          this.logger.log(`[BOT_INIT] ✅ Created bot user: ${email} (ID: ${bot.id})`);
        } else {
          this.logger.log(`[BOT_INIT] ⏭️ Bot user already exists: ${email} (ID: ${bot.id})`);
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
        `[BOT_INIT] Bot distribution: ${limitBotCount} limit bots (70%), ${marketBotCount} market bots (30%)`,
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

          this.logger.debug(
            `[BOT_STRATEGY] Assigned ${isLimitBot ? 'LimitOrder' : 'MarketOrder'} strategy to bot${botIndex + 1} for ${market.symbol}`,
          );
        }
      }

      this.logger.log(
        `[BOT_INIT] ✅ Initialized ${this.bots.length} bots with ${this.botConfigs.size} strategy instances`,
      );
    } catch (error) {
      this.logger.error(`[BOT_INIT] ❌ Failed to initialize bots:`, error);
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
    this.logger.log(`[BOT_LOOP] 🚀 Starting trading loop with ${this.bots.length} bots...`);

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
    this.logger.log('[BOT_LOOP] ✅ Trading loop started');
  }

  private listenToBinancePrices(): void {
    this.logger.log('[BOT_PRICE] 📡 Starting Binance price listener...');
    void this.updateBinancePrices();

    // Poll every 5 seconds to match Binance polling interval (tránh gọi quá nhiều)
    setInterval(() => {
      void this.updateBinancePrices();
    }, 5000);
  }

  private async updateBinancePrices(): Promise<void> {
    const markets = await this.marketRepo.find({
      where: { status: MarketStatus.ACTIVE },
    });

    for (const market of markets) {
      let binancePrice = await this.binanceService.getLastPrice(market.symbol);

      // Fallback: Use random price if Binance unavailable
      if (!binancePrice) {
        binancePrice = this.generateFallbackPrice(market.symbol);
        this.logger.debug(`[BOT_PRICE] Fallback: ${market.symbol} = ${binancePrice}`);
      }

      // Update average price for this symbol
      const oldAveragePrice = this.averagePrices.get(market.symbol) || 0;
      this.averagePrices.set(market.symbol, binancePrice);

      // Update all strategies with new price
      this.updateStrategies(market.symbol, binancePrice);

      // Check if limit bots need to cancel and replace orders (price changed >1%)
      if (oldAveragePrice > 0) {
        const priceChangePercent = Math.abs((binancePrice - oldAveragePrice) / oldAveragePrice);
        if (priceChangePercent > 0.01) {
          // Price changed > 1%, cancel and replace limit orders
          this.logger.log(
            `[BOT_PRICE] Price change >1% for ${market.symbol}: ${oldAveragePrice} -> ${binancePrice} (${(priceChangePercent * 100).toFixed(2)}%)`,
          );
          void this.cancelAndReplaceLimitOrders(market.symbol);
        }
      }
    }
  }

  private generateFallbackPrice(symbol: string): number {
    const basePrice: Record<string, number> = {
      BTC_USDT: 106900,
      ETH_USDT: 3633,
      SOL_USDT: 167.45,
    };

    const price = basePrice[symbol] || 100;
    const variation = 0.005 + Math.random() * 0.01;
    const direction = Math.random() > 0.5 ? 1 : -1;
    return price * (1 + direction * variation);
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

  /**
   * Cancel and replace limit orders when price changes >1%
   * Hủy lệnh từng cái một với delay, nhưng không block execution loop
   */
  private cancelAndReplaceLimitOrders(symbol: string): void {
    // Fire-and-forget: không block execution loop
    void (async () => {
      try {
        // Find all limit bots for this symbol
        for (const [, config] of this.botConfigs) {
          if (config.symbol === symbol && config.isLimitBot) {
            const bot = this.bots.find((b) => b.id.toString() === config.botId);
            if (!bot) continue;

            // Get open limit orders for this bot and symbol
            const openOrders = await this.orderRepo.find({
              where: {
                user: { id: bot.id },
                market: { symbol },
                status: OrderStatus.OPEN,
                type: OrderType.LIMIT,
              },
              relations: ['market'],
            });

            // Cancel orders từng cái một với delay để tạo cảm giác realtime
            // Chỉ hủy các lệnh có status OPEN (tránh hủy lệnh đã bị hủy)
            const ordersToCancel = openOrders.filter((o) => o.status === OrderStatus.OPEN);

            // Hủy từng lệnh với delay riêng, không block nhau
            for (let i = 0; i < ordersToCancel.length; i++) {
              const order = ordersToCancel[i];
              // Delay tăng dần: lệnh đầu tiên delay 0.5s, lệnh thứ 2 delay 1.5s, ...
              const delay = i * 1000 + 500 + Math.random() * 1000; // 0.5-1.5s, 1.5-2.5s, 2.5-3.5s...

              setTimeout(() => {
                void (async () => {
                  try {
                    await this.orderService.cancelOrder(bot, order.id);
                    this.logger.log(
                      `[BOT_CANCEL] Cancelled limit order ${order.id} for bot ${bot.email} on ${symbol}`,
                    );
                  } catch (error) {
                    // Bỏ qua lỗi nếu order đã bị hủy hoặc không còn OPEN
                    if (error instanceof Error && error.message.includes('status')) {
                      this.logger.debug(
                        `[BOT_CANCEL] Order ${order.id} already cancelled or not OPEN, skipping`,
                      );
                    } else {
                      this.logger.error(`[BOT_CANCEL] Failed to cancel order ${order.id}:`, error);
                    }
                  }
                })();
              }, delay);
            }

            // Bot có thể đặt lệnh mới ngay lập tức, không cần đợi hủy xong
          }
        }
      } catch (error) {
        this.logger.error(`[BOT_CANCEL] Failed to cancel and replace limit orders:`, error);
      }
    })();
  }

  private async executeBotStrategies(): Promise<void> {
    const now = Date.now();
    let executedCount = 0;

    for (const [, config] of this.botConfigs) {
      const interval = config.strategy.getInterval(); // 5-15s for limit, 10-30s for market
      if (now - config.lastAction < interval) continue;

      const bot = this.bots.find((b) => b.id.toString() === config.botId);
      if (!bot) continue;

      try {
        const action = config.strategy.getAction();
        if (!action) continue;

        // For limit bots, allow multiple orders (2-5 orders) to fill orderbook
        if (config.isLimitBot) {
          const openOrders = await this.orderRepo.find({
            where: {
              user: { id: bot.id },
              market: { symbol: config.symbol },
              status: OrderStatus.OPEN,
              type: OrderType.LIMIT,
            },
            relations: ['market'], // Load market relation for cancelOrder
            order: { createdAt: 'ASC' }, // Sort by oldest first
          });

          // Kiểm tra và hủy các lệnh có giá lệch quá xa so với giá hiện tại (>2%)
          const currentAveragePrice = this.averagePrices.get(config.symbol) || 0;
          if (currentAveragePrice > 0) {
            for (const order of openOrders) {
              const orderPrice = Number(order.price);
              const priceDiffPercent = Math.abs(
                (orderPrice - currentAveragePrice) / currentAveragePrice,
              );

              // Nếu giá lệch >2%, hủy lệnh đó
              if (priceDiffPercent > 0.02) {
                void (async () => {
                  try {
                    await this.orderService.cancelOrder(bot, order.id);
                    this.logger.log(
                      `[BOT_CANCEL] Cancelled order ${order.id} with price ${orderPrice} (diff: ${(priceDiffPercent * 100).toFixed(2)}%) vs current ${currentAveragePrice} for bot ${bot.email} on ${config.symbol}`,
                    );
                  } catch (error) {
                    this.logger.error(`[BOT_CANCEL] Failed to cancel order ${order.id}:`, error);
                  }
                })();
              }
            }
          }

          // Cho phép mỗi bot có 3-6 lệnh limit cùng lúc để orderbook đầy hơn
          // Tăng số lệnh thay vì tăng spread để giữ giá gần Binance
          const maxOrdersPerBot = Math.floor(Math.random() * 4) + 3; // 3-6 orders

          if (openOrders.length >= maxOrdersPerBot) {
            // Đã đủ số lệnh, kiểm tra xem có cần hủy lệnh cũ không
            const orderAge = now - config.lastOrderTime;
            const cancelInterval = Math.floor(Math.random() * 120000) + 60000; // 60-180 seconds

            if (orderAge > cancelInterval && openOrders.length > 0) {
              // Chỉ hủy 1 lệnh cũ nhất, không phải tất cả
              // Hủy lệnh không block việc đặt lệnh mới (fire-and-forget)
              const oldestOrder = openOrders[0];
              void (async () => {
                try {
                  // Delay ngẫu nhiên 0.5-2 giây trước khi hủy để tạo cảm giác realtime
                  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1500));
                  await this.orderService.cancelOrder(bot, oldestOrder.id);
                  this.logger.log(
                    `[BOT_CANCEL] Cancelled 1 old limit order ${oldestOrder.id} for bot ${bot.email} on ${config.symbol} (age: ${Math.floor(orderAge / 1000)}s)`,
                  );
                  // Reset lastOrderTime sau khi hủy xong
                  config.lastOrderTime = 0;
                } catch (error) {
                  this.logger.error(
                    `[BOT_CANCEL] Failed to cancel order ${oldestOrder.id}:`,
                    error,
                  );
                }
              })();

              // Tiếp tục đặt lệnh mới ngay, không đợi hủy xong
              // Reset lastOrderTime để cho phép đặt lệnh mới
              config.lastOrderTime = 0;
            } else {
              // Chưa đến lúc hủy hoặc chưa đủ lệnh, skip
              continue;
            }
          }
          // Nếu số lệnh < maxOrdersPerBot, tiếp tục đặt lệnh mới
        }

        this.logger.log(
          `[BOT_EXEC] Bot ${bot.email}: ${action.side} ${action.amount} @ ${action.price} (${config.isLimitBot ? 'LIMIT' : 'MARKET'}) on ${config.symbol}`,
        );

        await this.executeBotAction(bot, config.symbol, action, config.isLimitBot);

        executedCount++;
        config.lastAction = now;
      } catch (error) {
        this.logger.error(`[BOT_EXEC] ❌ Failed to execute action for ${bot.email}:`, error);
      }
    }

    if (executedCount > 0) {
      this.logger.debug(`[BOT_EXEC] ✅ Executed ${executedCount} bot actions`);
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
        this.logger.warn(`[BOT_ACTION] ⚠️ Market not found: ${symbol}`);
        return;
      }

      const createOrderDto: CreateOrderDto = {
        marketSymbol: market.symbol,
        side: action.side,
        type: isLimitBot ? OrderType.LIMIT : OrderType.MARKET,
        price: isLimitBot ? action.price : undefined, // Market orders don't need price
        amount: action.amount,
      };

      this.logger.log(
        `[BOT_ORDER] 📝 Creating ${isLimitBot ? 'LIMIT' : 'MARKET'} order for ${bot.email}: ${JSON.stringify(createOrderDto)}`,
      );

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

      this.logger.log(`[BOT_ORDER] ✅ Order created successfully for ${bot.email}: ${order.id}`);
    } catch (error) {
      this.logger.error(`[BOT_ORDER] ❌ Failed to create order:`, error);
    }
  }
}
