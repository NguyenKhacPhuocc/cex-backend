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
  private readonly PRICE_DEVIATION_THRESHOLD = 0.001; // 0.1% - thống nhất cho tất cả hàm cancel stale orders

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
          // pricePrecision is stored as integer (number of decimal places) in database
          // For low-price coins, increase precision to avoid rounding errors
          let pricePrecision =
            market.pricePrecision && market.pricePrecision > 0
              ? Math.round(Number(market.pricePrecision))
              : 2;

          // Auto-adjust precision based on current price to minimize rounding errors
          // Get current price from Binance if available
          const currentPrice = await this.binanceService.getLastPrice(market.symbol);
          if (currentPrice && currentPrice > 0) {
            // For coins with price < 1, use at least 4 decimals to avoid large rounding errors
            // For coins with price < 0.1, use at least 5 decimals
            if (currentPrice < 0.1) {
              pricePrecision = Math.max(pricePrecision, 5);
            } else if (currentPrice < 1) {
              pricePrecision = Math.max(pricePrecision, 4);
            } else if (currentPrice < 10) {
              pricePrecision = Math.max(pricePrecision, 3);
            }
          }

          strategy.setMarketInfo({
            minOrderSize: Number(market.minOrderSize),
            baseAsset: market.baseAsset,
            quoteAsset: market.quoteAsset,
            pricePrecision: pricePrecision,
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

  /**
   * Cancel stale orders that have large price deviation from current market price
   * This prevents spread from growing too large (300-400 USDT)
   * Giống Binance: hủy lệnh cũ ngay khi giá thay đổi đáng kể
   */
  private async cancelStaleOrders(): Promise<void> {
    const PRICE_DEVIATION_THRESHOLD = this.PRICE_DEVIATION_THRESHOLD;

    for (const [, config] of this.botConfigs) {
      if (!config.isLimitBot) continue;

      const currentPrice = this.averagePrices.get(config.symbol);
      if (!currentPrice || currentPrice <= 0) continue;

      const bot = this.bots.find((b) => b.id.toString() === config.botId);
      if (!bot) continue;

      try {
        const openOrders = await this.orderRepo.find({
          where: {
            user: { id: bot.id },
            market: { symbol: config.symbol },
            status: OrderStatus.OPEN,
            type: OrderType.LIMIT,
          },
          relations: ['market'],
        });

        // Filter tất cả orders có price deviation để cancel
        const staleOrders = openOrders.filter((order) => {
          const orderPrice = Number(order.price);
          if (!orderPrice || orderPrice <= 0) return false;
          const priceDiffPercent = Math.abs((orderPrice - currentPrice) / currentPrice);
          return priceDiffPercent > PRICE_DEVIATION_THRESHOLD;
        });

        if (staleOrders.length === 0) continue;

        this.logger.log(
          `[BOT_STALE] Found ${staleOrders.length} stale orders for ${bot.email} on ${config.symbol}, cancelling...`,
        );

        // Cancel tất cả stale orders với retry mechanism
        let cancelledCount = 0;
        for (const order of staleOrders) {
          const orderPrice = Number(order.price);
          const priceDiffPercent = Math.abs((orderPrice - currentPrice) / currentPrice);

          let cancelSuccess = false;
          let retryCount = 0;
          const MAX_RETRIES = 3;

          while (!cancelSuccess && retryCount < MAX_RETRIES) {
            try {
              await this.orderService.cancelOrder(bot, order.id);

              // Đợi DB update trước khi verify
              await new Promise((resolve) => setTimeout(resolve, 200));

              // Verify order đã bị cancel
              const verifyOrder = await this.orderRepo.findOne({
                where: { id: order.id },
              });

              if (verifyOrder && verifyOrder.status !== OrderStatus.OPEN) {
                cancelSuccess = true;
                cancelledCount++;
                this.logger.log(
                  `[BOT_STALE] ✅ Cancelled stale order ${order.id} for ${bot.email} on ${config.symbol}: price ${orderPrice} deviates ${(priceDiffPercent * 100).toFixed(2)}% from current ${currentPrice}`,
                );
              } else {
                // Order vẫn còn OPEN, retry
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                  //   this.logger.warn(
                  //     `[BOT_STALE] ⚠️ Order ${order.id} still OPEN after cancel, retrying... (${retryCount}/${MAX_RETRIES})`,
                  //   );
                  await new Promise((resolve) => setTimeout(resolve, 300 * retryCount));
                }
              }
            } catch (error) {
              // Kiểm tra xem order đã bị filled/cancelled chưa (đây là điều bình thường)
              if (error instanceof Error) {
                if (
                  error.message.includes('Cannot cancel order with status') &&
                  (error.message.includes('filled') || error.message.includes('cancelled'))
                ) {
                  // Order đã bị filled/cancelled - coi như success vì mục đích là order không còn OPEN
                  cancelSuccess = true;
                  cancelledCount++;
                  //   this.logger.debug(
                  //     `[BOT_STALE] Order ${order.id} already ${error.message.includes('filled') ? 'filled' : 'cancelled'}, skipping`,
                  //   );
                  break; // Thoát khỏi retry loop
                }
              }

              retryCount++;
              if (retryCount >= MAX_RETRIES) {
                this.logger.error(
                  `[BOT_STALE] ❌ Failed to cancel order ${order.id} after ${MAX_RETRIES} retries: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              } else {
                // this.logger.warn(
                //   `[BOT_STALE] Retry ${retryCount}/${MAX_RETRIES} for order ${order.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                // );
                await new Promise((resolve) => setTimeout(resolve, 300 * retryCount));
              }
            }
          }

          // Delay giữa các orders để tránh overwhelm
          if (staleOrders.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Reset config để bot đặt lệnh mới ngay nếu có orders đã cancel
        if (cancelledCount > 0) {
          const configKey = Array.from(this.botConfigs.keys()).find(
            (k) =>
              this.botConfigs.get(k)?.botId === bot.id.toString() &&
              this.botConfigs.get(k)?.symbol === config.symbol,
          );
          if (configKey) {
            const botConfig = this.botConfigs.get(configKey);
            if (botConfig) {
              botConfig.lastOrderTime = 0;
              botConfig.lastAction = 0;
            }
          }
          this.logger.log(
            `[BOT_STALE] Successfully cancelled ${cancelledCount}/${staleOrders.length} stale orders for ${bot.email} on ${config.symbol}`,
          );
        }
      } catch (error) {
        this.logger.error(`[BOT_STALE] Error checking stale orders for ${config.symbol}:`, error);
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
                  // Verify order status trước khi cancel (có thể đã bị filled giữa lúc query)
                  const currentOrder = await this.orderRepo.findOne({
                    where: { id: order.id },
                  });

                  if (!currentOrder) {
                    this.logger.debug(
                      `[BOT_REFILL] Order ${order.id} not found, may have been deleted`,
                    );
                    continue;
                  }

                  // Skip nếu order không còn OPEN hoặc PARTIALLY_FILLED
                  if (
                    currentOrder.status !== OrderStatus.OPEN &&
                    currentOrder.status !== OrderStatus.PARTIALLY_FILLED
                  ) {
                    this.logger.debug(
                      `[BOT_REFILL] Order ${order.id} already ${currentOrder.status}, skipping cancel`,
                    );
                    continue;
                  }

                  await this.orderService.cancelOrder(bot, order.id);
                  //   this.logger.log(
                  //     `[BOT_REFILL] Cancelled order ${order.id} to free up ${currency} for bot ${bot.email}`,
                  //   );
                  // Delay 1-3 giây giữa mỗi lần hủy để tạo cảm giác realtime
                  await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));
                } catch (error) {
                  // Xử lý lỗi gracefully - order có thể đã bị filled/cancelled bởi process khác
                  if (error instanceof Error) {
                    if (
                      error.message.includes('Cannot cancel order with status') ||
                      error.message.includes('filled') ||
                      error.message.includes('cancelled')
                    ) {
                      // Đây là điều bình thường - order đã bị filled/cancelled, chỉ log debug
                      this.logger.debug(
                        `[BOT_REFILL] Order ${order.id} cannot be cancelled: ${error.message}`,
                      );
                    } else {
                      // Lỗi khác - log error
                      this.logger.error(
                        `[BOT_REFILL] Failed to cancel order ${order.id}: ${error.message}`,
                      );
                    }
                  } else {
                    this.logger.error(`[BOT_REFILL] Failed to cancel order ${order.id}:`, error);
                  }
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

    // Main trading loop - run every 3 seconds for faster trading pace
    setInterval(() => {
      void this.executeBotStrategies();
    }, 3000);

    // Check and cancel stale orders periodically (every 5 seconds) - cancel orders with large price deviation
    // Tăng tần suất để catch lệnh cũ sớm hơn khi giá thay đổi từ từ
    setInterval(() => {
      void this.cancelStaleOrders();
    }, 5000); // 5 giây thay vì 10 giây

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

      // Lấy giá cũ trước khi cập nhật
      const oldPrice = this.averagePrices.get(market.symbol);

      // Update average price for this symbol
      this.averagePrices.set(market.symbol, binancePrice);

      // Update all strategies with new price
      this.updateStrategies(market.symbol, binancePrice);

      // ✅ Nếu giá thay đổi đáng kể, tự động hủy lệnh cũ và trigger đặt lệnh mới
      if (oldPrice && oldPrice > 0) {
        const priceChangePercent = Math.abs((binancePrice - oldPrice) / oldPrice);
        const PRICE_CHANGE_THRESHOLD = 0.0015; // 0.15% - nếu giá thay đổi > 0.15%

        if (priceChangePercent > PRICE_CHANGE_THRESHOLD) {
          // Giá thay đổi đáng kể → hủy lệnh cũ và trigger đặt lệnh mới
          this.logger.log(
            `[BOT_PRICE] Price changed ${(priceChangePercent * 100).toFixed(2)}% for ${market.symbol}: ${oldPrice} → ${binancePrice}, triggering order adjustment`,
          );

          // Hủy lệnh cũ và reset để đặt lệnh mới ngay
          await this.adjustOrdersForPriceChange(market.symbol, binancePrice);
        }
      }
    }
  }

  /**
   * Hủy lệnh cũ và reset để bot đặt lệnh mới ngay khi giá thay đổi đáng kể
   * Giống Binance: cancel + replace ngay khi giá thay đổi
   */
  private async adjustOrdersForPriceChange(symbol: string, newPrice: number): Promise<void> {
    const PRICE_DEVIATION_THRESHOLD = this.PRICE_DEVIATION_THRESHOLD;

    for (const [, config] of this.botConfigs) {
      if (!config.isLimitBot || config.symbol !== symbol) continue;

      const bot = this.bots.find((b) => b.id.toString() === config.botId);
      if (!bot) continue;

      try {
        const openOrders = await this.orderRepo.find({
          where: {
            user: { id: bot.id },
            market: { symbol: config.symbol },
            status: OrderStatus.OPEN,
            type: OrderType.LIMIT,
          },
          relations: ['market'],
        });

        // Filter tất cả orders có price deviation để cancel
        const staleOrders = openOrders.filter((order) => {
          const orderPrice = Number(order.price);
          if (!orderPrice || orderPrice <= 0) return false;
          const priceDiffPercent = Math.abs((orderPrice - newPrice) / newPrice);
          return priceDiffPercent > PRICE_DEVIATION_THRESHOLD;
        });

        if (staleOrders.length === 0) continue;

        this.logger.log(
          `[BOT_ADJUST] Found ${staleOrders.length} stale orders for ${bot.email} on ${config.symbol} after price change, cancelling...`,
        );

        // Cancel tất cả stale orders với retry mechanism
        let cancelledCount = 0;
        for (const order of staleOrders) {
          const orderPrice = Number(order.price);
          const priceDiffPercent = Math.abs((orderPrice - newPrice) / newPrice);

          let cancelSuccess = false;
          let retryCount = 0;
          const MAX_RETRIES = 3;

          while (!cancelSuccess && retryCount < MAX_RETRIES) {
            try {
              await this.orderService.cancelOrder(bot, order.id);

              // Đợi DB update trước khi verify
              await new Promise((resolve) => setTimeout(resolve, 200));

              // Verify order đã bị cancel
              const verifyOrder = await this.orderRepo.findOne({
                where: { id: order.id },
              });

              if (verifyOrder && verifyOrder.status !== OrderStatus.OPEN) {
                cancelSuccess = true;
                cancelledCount++;
                this.logger.log(
                  `[BOT_ADJUST] ✅ Cancelled order ${order.id} for ${bot.email} on ${config.symbol}: price ${orderPrice} deviates ${(priceDiffPercent * 100).toFixed(2)}% from new price ${newPrice}`,
                );
              } else {
                // Order vẫn còn OPEN, retry
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                  this.logger.warn(
                    `[BOT_ADJUST] ⚠️ Order ${order.id} still OPEN after cancel, retrying... (${retryCount}/${MAX_RETRIES})`,
                  );
                  await new Promise((resolve) => setTimeout(resolve, 300 * retryCount));
                }
              }
            } catch (error) {
              // Kiểm tra xem order đã bị filled/cancelled chưa (đây là điều bình thường)
              if (error instanceof Error) {
                if (
                  error.message.includes('Cannot cancel order with status') &&
                  (error.message.includes('filled') || error.message.includes('cancelled'))
                ) {
                  // Order đã bị filled/cancelled - coi như success vì mục đích là order không còn OPEN
                  cancelSuccess = true;
                  cancelledCount++;
                  this.logger.debug(
                    `[BOT_ADJUST] Order ${order.id} already ${error.message.includes('filled') ? 'filled' : 'cancelled'}, skipping`,
                  );
                  break; // Thoát khỏi retry loop
                }
              }

              retryCount++;
              if (retryCount >= MAX_RETRIES) {
                this.logger.error(
                  `[BOT_ADJUST] ❌ Failed to cancel order ${order.id} after ${MAX_RETRIES} retries: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
              } else {
                this.logger.warn(
                  `[BOT_ADJUST] Retry ${retryCount}/${MAX_RETRIES} for order ${order.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                );
                await new Promise((resolve) => setTimeout(resolve, 300 * retryCount));
              }
            }
          }

          // Delay giữa các orders để tránh overwhelm
          if (staleOrders.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Reset config để bot đặt lệnh mới ngay nếu có orders đã cancel
        if (cancelledCount > 0) {
          config.lastAction = 0;
          config.lastOrderTime = 0;
          this.logger.log(
            `[BOT_ADJUST] Successfully cancelled ${cancelledCount}/${staleOrders.length} stale orders for ${bot.email} on ${config.symbol}`,
          );
        }
      } catch (error) {
        this.logger.error(`[BOT_ADJUST] Error adjusting orders for ${symbol}:`, error);
      }
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
    const BATCH_SIZE = 8; // Process 8 bots at a time (increased from 5 for faster processing)

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
                const currentAveragePrice = this.averagePrices.get(config.symbol);

                // ✅ Ưu tiên: Cancel TẤT CẢ orders có price deviation trước
                if (currentAveragePrice && currentAveragePrice > 0) {
                  const staleOrders = openOrders.filter((order) => {
                    const orderPrice = Number(order.price);
                    if (!orderPrice || orderPrice <= 0) return false;
                    const priceDiffPercent = Math.abs(
                      (orderPrice - currentAveragePrice) / currentAveragePrice,
                    );
                    return priceDiffPercent > this.PRICE_DEVIATION_THRESHOLD;
                  });

                  if (staleOrders.length > 0) {
                    // Cancel tất cả stale orders
                    let cancelledCount = 0;
                    for (const staleOrder of staleOrders) {
                      try {
                        await Promise.race([
                          this.orderService.cancelOrder(bot, staleOrder.id),
                          new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Cancel timeout')), 3000),
                          ),
                        ]);

                        // Đợi DB update
                        await new Promise((resolve) => setTimeout(resolve, 200));

                        // Verify
                        const verifyOrder = await this.orderRepo.findOne({
                          where: { id: staleOrder.id },
                        });

                        if (verifyOrder && verifyOrder.status !== OrderStatus.OPEN) {
                          cancelledCount++;
                          this.logger.debug(
                            `[BOT_CANCEL] ✅ Cancelled stale order ${staleOrder.id} due to price deviation`,
                          );
                        }
                      } catch (error) {
                        // Xử lý lỗi gracefully - order có thể đã bị filled/cancelled
                        if (error instanceof Error) {
                          const isAlreadyFilledOrCancelled =
                            error.message.includes('Cannot cancel order with status') &&
                            (error.message.includes('filled') ||
                              error.message.includes('cancelled'));
                          if (isAlreadyFilledOrCancelled) {
                            // Order đã bị filled/cancelled - đây là điều bình thường
                            const status = error.message.includes('filled')
                              ? 'filled'
                              : 'cancelled';
                            this.logger.debug(
                              `[BOT_CANCEL] Order ${staleOrder.id} already ${status}, skipping`,
                            );
                            cancelledCount++; // Coi như success vì order không còn OPEN
                          } else {
                            this.logger.debug(
                              `[BOT_CANCEL] Failed to cancel stale order ${staleOrder.id}: ${error.message}`,
                            );
                          }
                        } else {
                          this.logger.debug(
                            `[BOT_CANCEL] Failed to cancel stale order ${staleOrder.id}: Unknown error`,
                          );
                        }
                      }

                      // Delay giữa các orders
                      if (staleOrders.length > 1) {
                        await new Promise((resolve) => setTimeout(resolve, 100));
                      }
                    }

                    if (cancelledCount > 0) {
                      config.lastOrderTime = 0;
                      config.lastAction = 0;
                      this.logger.debug(
                        `[BOT_CANCEL] Cancelled ${cancelledCount}/${staleOrders.length} stale orders due to price deviation`,
                      );
                    }
                    return { skipped: true };
                  }
                }

                // Nếu không có stale orders, check order age và cancel oldest
                const orderAge = now - config.lastOrderTime;
                const cancelInterval = Math.floor(Math.random() * 40000) + 20000; // 20-40 seconds

                if (orderAge > cancelInterval && openOrders.length > 0) {
                  const oldestOrder = openOrders[0];
                  try {
                    await Promise.race([
                      this.orderService.cancelOrder(bot, oldestOrder.id),
                      new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Cancel timeout')), 3000),
                      ),
                    ]);

                    await new Promise((resolve) => setTimeout(resolve, 200));

                    // Verify
                    const verifyOrder = await this.orderRepo.findOne({
                      where: { id: oldestOrder.id },
                    });

                    if (verifyOrder && verifyOrder.status !== OrderStatus.OPEN) {
                      config.lastOrderTime = 0;
                      config.lastAction = 0;
                      this.logger.debug(
                        `[BOT_CANCEL] ✅ Cancelled order ${oldestOrder.id} due to age`,
                      );
                    }
                  } catch (error) {
                    // Xử lý lỗi gracefully
                    if (error instanceof Error) {
                      if (
                        error.message.includes('Cannot cancel order with status') &&
                        (error.message.includes('filled') || error.message.includes('cancelled'))
                      ) {
                        // Order đã bị filled/cancelled - đây là điều bình thường
                        this.logger.debug(
                          `[BOT_CANCEL] Order ${oldestOrder.id} already ${error.message.includes('filled') ? 'filled' : 'cancelled'}, skipping`,
                        );
                        // Coi như success và reset để đặt lệnh mới
                        config.lastOrderTime = 0;
                        config.lastAction = 0;
                      } else if (error.message !== 'Cancel timeout') {
                        this.logger.debug(
                          `[BOT_CANCEL] Order ${oldestOrder.id} might be already cancelled/filled: ${error.message}`,
                        );
                      } else {
                        this.logger.warn(
                          `[BOT_CANCEL] Failed to cancel order ${oldestOrder.id}: ${error.message}`,
                        );
                      }
                    } else {
                      this.logger.warn(
                        `[BOT_CANCEL] Failed to cancel order ${oldestOrder.id}: Unknown error`,
                      );
                    }
                  }
                  return { skipped: true };
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

                // Reject order if price deviation >2% (reduced from 5% for tighter spreads)
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

      // Smaller delay between batches for faster processing
      if (i + BATCH_SIZE < botConfigsArray.length) {
        await new Promise((resolve) => setTimeout(resolve, 5));
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
