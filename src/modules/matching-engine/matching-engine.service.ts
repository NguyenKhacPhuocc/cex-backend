/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RedisService } from 'src/core/redis/redis.service';
import { RedisPubSub } from 'src/core/redis/redis.pubsub';
import { REDIS_KEYS } from 'src/common/constants/redis-keys';
import { Order } from 'src/modules/order/entities/order.entity';
import { OrderSide, OrderStatus, OrderType } from 'src/shared/enums';
import { OrderBookService } from '../trading/order-book.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { Market } from 'src/modules/market/entities/market.entity';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { Trade } from '../trades/entities/trade.entity';
import {
  Transaction,
  TransactionType,
  TransactionStatus,
} from '../transactions/entities/transaction.entity';
import { LedgerEntry, LedgerReferenceType } from '../ledger/entities/ledger.entity';
import { TradingWebSocketGateway } from 'src/core/websocket/websocket.gateway';
import { CandlesService } from '../candles/candles.service';
import { Timeframe } from '../candles/entities/candle.entity';
import { WalletCalculationService } from 'src/common/services/wallet-calculation.service';

@Injectable()
export class MatchingEngineService implements OnModuleInit {
  private readonly logger = new Logger(MatchingEngineService.name);

  constructor(
    private readonly orderBookService: OrderBookService,
    private readonly redisService: RedisService,
    private readonly redisPubSub: RedisPubSub,
    private readonly wsGateway: TradingWebSocketGateway,
    private readonly candlesService: CandlesService,
    private readonly walletCalculationService: WalletCalculationService,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Market)
    private marketRepo: Repository<Market>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
    @InjectRepository(Trade)
    private tradeRepo: Repository<Trade>,
    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private ledgerRepo: Repository<LedgerEntry>,
  ) {}

  onModuleInit() {
    this.redisPubSub.subscribe(REDIS_KEYS.ORDER_CANCEL_CHANNEL);
    this.redisPubSub.onMessage((channel, message) => {
      if (channel === REDIS_KEYS.ORDER_CANCEL_CHANNEL) {
        this.handleCancelOrder(message);
      }
    });
  }

  async handleCancelOrder(message: unknown): Promise<void> {
    // Cast message from PubSub to Order
    const order = message as Order;
    await this.orderBookService.remove(order);
  }

  /**
   * Check for self-trade and cancel the existing conflicting order to prevent crossed book
   * Similar to real exchanges like Binance
   */
  private async checkAndCancelSelfTrade(newOrder: Order): Promise<void> {
    // Only check for LIMIT orders with specific prices
    if (newOrder.type !== OrderType.LIMIT || !newOrder.price) {
      return;
    }

    const oppositeSide = newOrder.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    const bestMatch = await this.orderBookService.getBest(newOrder.market.symbol, oppositeSide);

    if (!bestMatch) {
      return; // No conflict
    }

    // Check if best match is from the same user
    if (bestMatch.user.id !== newOrder.user.id) {
      return; // Different users, no self-trade
    }

    // Check if prices would cross
    const wouldCross =
      newOrder.side === OrderSide.BUY
        ? Number(newOrder.price) >= Number(bestMatch.price)
        : Number(newOrder.price) <= Number(bestMatch.price);

    if (wouldCross) {
      // Cancel the existing order to prevent self-trade
      // Remove from order book
      await this.orderBookService.remove(bestMatch);

      // Update status in database
      bestMatch.status = OrderStatus.CANCELED;
      await this.orderRepo.save(bestMatch);

      // Emit WebSocket event to notify user
      this.wsGateway.emitOrderUpdate(String(newOrder.user.id), bestMatch.id, OrderStatus.CANCELED);

      // Publish cache invalidation
      await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
        userId: newOrder.user.id,
      });
    }
  }

  async processOrder(order: Order): Promise<void> {
    // Eagerly load full User and Market entities for the order
    const fullUser = await this.userRepo.findOne({
      where: { id: order.user.id },
    });
    const fullMarket = await this.marketRepo.findOne({
      where: { id: order.market.id },
    });

    if (!fullUser || !fullMarket) {
      // If user or market not found, order cannot be processed
      // This should not happen in normal flow, but handle gracefully
      this.logger.error(
        `Cannot process order ${order.id}: ${!fullUser ? 'User not found' : ''} ${!fullMarket ? 'Market not found' : ''}`,
      );
      return;
    }

    order.user = fullUser;
    order.market = fullMarket;

    // ⭐ Early self-trade prevention: Check and cancel conflicting order before matching
    // This only cancels existing orders from the same user if they would cross
    // It does NOT prevent the new order from being added to orderbook
    await this.checkAndCancelSelfTrade(order);

    let remainingAmount = order.amount;

    if (order.type === OrderType.LIMIT) {
      remainingAmount = await this.processLimitOrder(order);
    } else if (order.type === OrderType.MARKET) {
      remainingAmount = await this.processMarketOrder(order);
    }

    // Update order status based on remaining amount
    if (remainingAmount <= 0) {
      order.status = OrderStatus.FILLED;
    } else if (remainingAmount < order.amount) {
      order.status = OrderStatus.PARTIALLY_FILLED;
    } else {
      order.status = OrderStatus.OPEN;
    }
    // order.amount = remainingAmount; // Update the order's remaining amount

    // Save the Order entity to the database for the first time
    const newOrderEntity = this.orderRepo.create({
      id: order.id, // Keep the UUID generated in order.service.ts
      user: { id: order.user.id }, // không trả về toàn bộ user mà chỉ có mỗi userId thôi
      market: order.market,
      side: order.side,
      type: order.type,
      price: Number(order.price), // Explicitly convert to Number
      amount: Number(order.amount), // Explicitly convert to Number
      filled: Number(order.filled), // Explicitly convert to Number
      status: order.status,
      createdAt: order.createdAt, // Ensure createdAt is preserved
      updatedAt: order.updatedAt, // Ensure updatedAt is preserved
    });

    await this.orderRepo.save(newOrderEntity);

    // For market BUY orders: Unlock remaining frozen balance that wasn't used
    // Market BUY locks entire available balance, but only uses tradeValue
    if (
      order.type === OrderType.MARKET &&
      order.side === OrderSide.BUY &&
      order.status !== OrderStatus.OPEN
    ) {
      const currencyToUnlock = order.market.quoteAsset;
      const wallet = await this.walletRepo.findOne({
        where: {
          user: { id: order.user.id },
          currency: currencyToUnlock,
          walletType: WalletType.SPOT,
        },
      });

      if (wallet && Number(wallet.frozen) > 0) {
        // Calculate total trade value used (from filled amount)
        // We need to estimate from filled amount since we don't track exact trade values
        // For simplicity, unlock all remaining frozen (since order is filled/partially filled)
        // The actual unlocking happens in executeTrade, but we need to handle remaining frozen
        const remainingFrozen = Number(wallet.frozen);
        if (remainingFrozen > 0) {
          this.walletCalculationService.unlockBalance(wallet, remainingFrozen);
          await this.walletRepo.save(wallet);
          this.logger.debug(
            `Unlocked remaining frozen balance for market BUY order ${order.id}: ${remainingFrozen} ${currencyToUnlock}`,
          );
        }
      }
    }

    // Publish message to invalidate cache for the user of the processed order
    const takerUserId = order.user.id;
    await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
      userId: takerUserId,
    });

    // Emit WebSocket event to notify user about order status update
    this.wsGateway.emitOrderUpdate(String(takerUserId), newOrderEntity.id, newOrderEntity.status);

    // Broadcast orderbook update to all subscribers (fire-and-forget to avoid blocking)
    // This ensures order processing completes quickly
    this.wsGateway.broadcastOrderBookUpdate(order.market.symbol).catch((error) => {
      this.logger.error(`Error broadcasting orderbook update:`, error);
    });
  }

  private async processLimitOrder(order: Order): Promise<number> {
    const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    let remainingAmount = order.amount;
    const maxIterations = 100; // Prevent infinite loops
    let iterations = 0;
    const skippedSelfMatches: Order[] = []; // Track self-match orders to add back later

    while (remainingAmount > 0 && iterations < maxIterations) {
      iterations++;

      // tìm kiếm order tốt nhất từ bên đối diện
      const bestMatch = await this.orderBookService.getBest(order.market.symbol, oppositeSide);

      if (!bestMatch) {
        // No more matches available, add back all skipped self-match orders
        for (const skippedOrder of skippedSelfMatches) {
          await this.orderBookService.add(skippedOrder);
        }
        skippedSelfMatches.length = 0; // Clear array
        break; // No match found, break the loop
      }

      // Prevent self-matching (self-trade prevention)
      // Note: Different bots are different users, so they can trade with each other
      // This only prevents the same user from matching with themselves
      if (bestMatch.user.id === order.user.id) {
        // Skip this match - continue to next best match instead of breaking
        // This allows the order to match with other users' orders
        this.logger.debug(
          `Self-trade prevention: skipping match for user ${order.user.id}, order ${order.id} vs ${bestMatch.id}, continuing to next match`,
        );
        // Temporarily remove self-match order from orderbook to skip it
        skippedSelfMatches.push(bestMatch);
        await this.orderBookService.remove(bestMatch);
        // Continue to next iteration to find next best match
        continue;
      }

      const canMatch =
        order.side === OrderSide.BUY
          ? Number(order.price) >= Number(bestMatch.price)
          : Number(order.price) <= Number(bestMatch.price);

      if (!canMatch) {
        break; // Price does not match - no more matches possible
      }

      // Immediately remove the matched order from the book to lock it
      await this.orderBookService.remove(bestMatch);

      const matchedAmount = Math.min(
        Number(remainingAmount),
        Number(bestMatch.amount) - Number(bestMatch.filled),
      );

      // Execute the trade
      await this.executeTrade(order, bestMatch, matchedAmount);

      remainingAmount = Number(remainingAmount) - Number(matchedAmount);
      order.filled = Number(order.filled) + Number(matchedAmount);
      bestMatch.filled = Number(bestMatch.filled) + Number(matchedAmount);

      if (Number(bestMatch.filled) < Number(bestMatch.amount)) {
        // If the matched order is not fully filled, add it back to the order book with the updated state.
        await this.orderBookService.add(bestMatch);
        bestMatch.status = OrderStatus.PARTIALLY_FILLED;
      } else {
        bestMatch.status = OrderStatus.FILLED;
      }
      await this.orderRepo.save(bestMatch);

      // Publish message to invalidate cache for the maker user
      await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
        userId: bestMatch.user.id,
      });

      // Emit WebSocket event to notify maker user about order status update
      this.wsGateway.emitOrderUpdate(String(bestMatch.user.id), bestMatch.id, bestMatch.status);
    }

    // Add back all skipped self-match orders to orderbook
    for (const skippedOrder of skippedSelfMatches) {
      await this.orderBookService.add(skippedOrder);
    }

    const remaining = Number(remainingAmount);

    if (remaining > 0) {
      // At this point, order.market should already be loaded in processOrder()
      // But add safety check and reload if needed
      if (!order.market || !order.market.symbol) {
        this.logger.warn(`Order ${order.id} missing market symbol, attempting to reload`);
        const marketId = order.market?.id;
        if (marketId) {
          const marketReload = await this.marketRepo.findOne({
            where: { id: marketId },
          });
          if (marketReload) {
            order.market = marketReload;
            this.logger.debug(`Successfully reloaded market for order ${order.id}`);
          } else {
            // Cannot add to orderbook without market symbol
            this.logger.error(
              `Cannot add order ${order.id} to orderbook: market ${marketId} not found`,
            );
            return remaining;
          }
        } else {
          // No market information available - cannot add to orderbook
          this.logger.error(`Cannot add order ${order.id} to orderbook: no market information`);
          return remaining;
        }
      }

      try {
        await this.orderBookService.add(order);
        this.logger.log(
          `✅ Successfully added order ${order.id} (${order.side} ${order.market.symbol} @ ${order.price}) to orderbook`,
        );
      } catch (error) {
        this.logger.error(
          `❌ Failed to add order ${order.id} (${order.side} ${order.market.symbol} @ ${order.price}) to orderbook:`,
          error,
        );
        // This is a critical error - an order that should be in the orderbook is not
        // But we continue processing to avoid blocking other orders
      }
    } else if (remaining === 0) {
      try {
        await this.orderBookService.remove(order);
      } catch {
        // Silently ignore removal errors
      }
    }

    return remaining;
  }

  private async processMarketOrder(order: Order): Promise<number> {
    const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    let remainingAmount = order.amount;
    const skippedSelfMatches: Order[] = []; // Track self-match orders to add back later

    while (Number(remainingAmount) > 0) {
      const bestMatch = await this.orderBookService.getBest(order.market.symbol, oppositeSide);

      if (!bestMatch) {
        // No more matches available, add back all skipped self-match orders
        for (const skippedOrder of skippedSelfMatches) {
          await this.orderBookService.add(skippedOrder);
        }
        skippedSelfMatches.length = 0; // Clear array
        break; // No match found
      }

      // Prevent self-matching (self-trade prevention)
      // Continue to next best match instead of breaking
      if (bestMatch.user.id === order.user.id) {
        this.logger.debug(
          `Self-trade prevention: skipping market order match for user ${order.user.id}, order ${order.id} vs ${bestMatch.id}, continuing to next match`,
        );
        // Temporarily remove self-match order from orderbook to skip it
        skippedSelfMatches.push(bestMatch);
        await this.orderBookService.remove(bestMatch);
        // Continue to next iteration to find next best match
        continue;
      }

      // Immediately remove the matched order from the book
      await this.orderBookService.remove(bestMatch);

      const matchedAmount = Math.min(
        Number(remainingAmount),
        Number(bestMatch.amount) - Number(bestMatch.filled),
      );

      // Execute the trade
      await this.executeTrade(order, bestMatch, matchedAmount);

      remainingAmount = Number(remainingAmount) - Number(matchedAmount);
      order.filled = Number(order.filled) + Number(matchedAmount);
      bestMatch.filled = Number(bestMatch.filled) + Number(matchedAmount);

      if (Number(bestMatch.filled) < Number(bestMatch.amount)) {
        // If the matched order is not fully filled, add it back to the order book.
        await this.orderBookService.add(bestMatch);
        bestMatch.status = OrderStatus.PARTIALLY_FILLED;
      } else {
        bestMatch.status = OrderStatus.FILLED;
      }
      await this.orderRepo.save(bestMatch);

      // Publish message to invalidate cache for the maker user
      await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
        userId: bestMatch.user.id,
      });

      // Emit WebSocket event to notify maker user about order status update
      this.wsGateway.emitOrderUpdate(String(bestMatch.user.id), bestMatch.id, bestMatch.status);
    }

    // Add back all skipped self-match orders to orderbook
    for (const skippedOrder of skippedSelfMatches) {
      await this.orderBookService.add(skippedOrder);
    }

    return Number(remainingAmount);
  }

  private async executeTrade(
    takerOrder: Order,
    makerOrder: Order,
    matchedAmount: number,
  ): Promise<void> {
    // --- Load user và market đầy đủ ---
    const [fullTakerUser, fullMakerUser, fullTakerMarket, fullMakerMarket] = await Promise.all([
      this.userRepo.findOne({ where: { id: takerOrder.user.id } }),
      this.userRepo.findOne({ where: { id: makerOrder.user.id } }),
      this.marketRepo.findOne({ where: { id: takerOrder.market.id } }),
      this.marketRepo.findOne({ where: { id: makerOrder.market.id } }),
    ]);

    if (!fullTakerUser || !fullMakerUser || !fullTakerMarket || !fullMakerMarket) {
      return;
    }

    takerOrder.user = fullTakerUser;
    makerOrder.user = fullMakerUser;
    takerOrder.market = fullTakerMarket;
    makerOrder.market = fullMakerMarket;

    // Prevent self-trade (should not happen, but double check)
    if (takerOrder.user.id === makerOrder.user.id) {
      return;
    }

    // For market orders, makerOrder.price should always be valid (limit order)
    // But add safety check to prevent NaN
    const tradePrice = Number(makerOrder.price);
    if (!tradePrice || isNaN(tradePrice) || tradePrice <= 0) {
      this.logger.error(
        `Invalid trade price: makerOrder.price=${makerOrder.price}, orderId=${makerOrder.id}`,
      );
      return;
    }
    const tradeValue = tradePrice * Number(matchedAmount);

    // Validate tradeValue is not NaN
    if (isNaN(tradeValue) || tradeValue <= 0) {
      this.logger.error(
        `Invalid trade value: tradePrice=${tradePrice}, matchedAmount=${matchedAmount}, orderId=${makerOrder.id}`,
      );
      return;
    }

    // --- Ghi bản ghi Trade ---
    const buyOrder = takerOrder.side === OrderSide.BUY ? takerOrder : makerOrder;
    const sellOrder = takerOrder.side === OrderSide.SELL ? takerOrder : makerOrder;

    const trade = this.tradeRepo.create({
      market: takerOrder.market,
      price: tradePrice,
      amount: matchedAmount,
      buyOrder,
      sellOrder,
      buyer: buyOrder.user,
      seller: sellOrder.user,
      takerSide: takerOrder.side === OrderSide.BUY ? 'BUY' : 'SELL', // Save taker side for market display
    });
    await this.tradeRepo.save(trade);

    // --- Xác định buyer/seller và ví liên quan ---
    const buyerUser = buyOrder.user;
    const sellerUser = sellOrder.user;
    const market = takerOrder.market;

    const [buyerQuoteWallet, buyerBaseWallet, sellerBaseWallet, sellerQuoteWallet] =
      await Promise.all([
        this.walletRepo.findOne({
          where: {
            user: { id: buyerUser.id },
            currency: market.quoteAsset,
            walletType: WalletType.SPOT,
          },
        }),
        this.walletRepo.findOne({
          where: {
            user: { id: buyerUser.id },
            currency: market.baseAsset,
            walletType: WalletType.SPOT,
          },
        }),
        this.walletRepo.findOne({
          where: {
            user: { id: sellerUser.id },
            currency: market.baseAsset,
            walletType: WalletType.SPOT,
          },
        }),
        this.walletRepo.findOne({
          where: {
            user: { id: sellerUser.id },
            currency: market.quoteAsset,
            walletType: WalletType.SPOT,
          },
        }),
      ]);

    if (!buyerQuoteWallet || !buyerBaseWallet || !sellerBaseWallet || !sellerQuoteWallet) {
      return;
    }

    // --- Cập nhật ví khi có 2 user khác nhau ---
    // Use WalletCalculationService for all balance updates
    if (takerOrder.side === OrderSide.BUY) {
      // Buyer (taker): Unlock frozen quote, add available base
      this.walletCalculationService.subtractFromFrozen(buyerQuoteWallet, tradeValue);
      this.walletCalculationService.addToAvailable(buyerBaseWallet, matchedAmount);

      // Seller (maker): Unlock frozen base, add available quote
      this.walletCalculationService.subtractFromFrozen(sellerBaseWallet, matchedAmount);
      this.walletCalculationService.addToAvailable(sellerQuoteWallet, tradeValue);
    } else if (takerOrder.side === OrderSide.SELL) {
      // Seller (taker): Unlock frozen base, add available quote
      this.walletCalculationService.subtractFromFrozen(sellerBaseWallet, matchedAmount);
      this.walletCalculationService.addToAvailable(sellerQuoteWallet, tradeValue);

      // Buyer (maker): Unlock frozen quote, add available base
      this.walletCalculationService.subtractFromFrozen(buyerQuoteWallet, tradeValue);
      this.walletCalculationService.addToAvailable(buyerBaseWallet, matchedAmount);
    }

    // Recalculate all balances
    this.walletCalculationService.recalculateBalances(
      buyerQuoteWallet,
      buyerBaseWallet,
      sellerBaseWallet,
      sellerQuoteWallet,
    );

    // --- Kiểm tra an toàn ---
    if (
      !this.walletCalculationService.areValidWallets(
        buyerQuoteWallet,
        buyerBaseWallet,
        sellerBaseWallet,
        sellerQuoteWallet,
      )
    ) {
      return;
    }

    // --- Ghi thay đổi vào DB ---
    await this.walletRepo.save([
      buyerQuoteWallet,
      buyerBaseWallet,
      sellerBaseWallet,
      sellerQuoteWallet,
    ]);

    // --- Lưu bản ghi vào transactions ---
    const buyerTransaction = this.transactionRepo.create({
      user: buyerUser,
      wallet: buyerBaseWallet,
      type: TransactionType.TRADE_BUY,
      amount: matchedAmount,
      currency: market.baseAsset,
      status: TransactionStatus.COMPLETED,
      createdAt: new Date(),
    });
    const sellerTransaction = this.transactionRepo.create({
      user: sellerUser,
      wallet: sellerQuoteWallet,
      type: TransactionType.TRADE_SELL,
      amount: tradeValue,
      currency: market.quoteAsset,
      status: TransactionStatus.COMPLETED,
      createdAt: new Date(),
    });
    await this.transactionRepo.save([buyerTransaction, sellerTransaction]);

    // --- Lưu bản ghi vào ledger_entries ---
    const ledgerEntries: LedgerEntry[] = [
      // Buyer: giảm frozen quote
      this.ledgerRepo.create({
        user: { id: buyerUser.id },
        wallet: { id: buyerQuoteWallet.id },
        currency: market.quoteAsset,
        changeAmount: -tradeValue,
        balanceBefore: Number(buyerQuoteWallet.balance) + tradeValue,
        balanceAfter: Number(buyerQuoteWallet.balance),
        referenceType: LedgerReferenceType.TRADE_BUY,
        referenceId: String(trade.id),
        description: `Decrease frozen for buy order ${takerOrder.id}`,
        createdAt: new Date(),
      }),
      // Buyer: tăng available base
      this.ledgerRepo.create({
        user: { id: buyerUser.id },
        wallet: { id: buyerBaseWallet.id },
        currency: market.baseAsset,
        changeAmount: matchedAmount,
        balanceBefore: Number(buyerBaseWallet.balance) - matchedAmount,
        balanceAfter: Number(buyerBaseWallet.balance),
        referenceType: LedgerReferenceType.TRADE_BUY,
        referenceId: String(trade.id),
        description: `Increase available for buy order ${takerOrder.id}`,
        createdAt: new Date(),
      }),
      // Seller: giảm frozen base
      this.ledgerRepo.create({
        user: { id: sellerUser.id },
        wallet: { id: sellerBaseWallet.id },
        currency: market.baseAsset,
        changeAmount: -matchedAmount,
        balanceBefore: Number(sellerBaseWallet.balance) + matchedAmount,
        balanceAfter: Number(sellerBaseWallet.balance),
        referenceType: LedgerReferenceType.TRADE_SELL,
        referenceId: String(trade.id),
        description: `Decrease frozen for sell order ${makerOrder.id}`,
        createdAt: new Date(),
      }),
      // Seller: tăng available quote
      this.ledgerRepo.create({
        user: { id: sellerUser.id },
        wallet: { id: sellerQuoteWallet.id },
        currency: market.quoteAsset,
        changeAmount: tradeValue,
        balanceBefore: Number(sellerQuoteWallet.balance) - tradeValue,
        balanceAfter: Number(sellerQuoteWallet.balance),
        referenceType: LedgerReferenceType.TRADE_SELL,
        referenceId: String(trade.id),
        description: `Increase available for sell order ${makerOrder.id}`,
        createdAt: new Date(),
      }),
    ];
    await this.ledgerRepo.save(ledgerEntries);

    // 🔥 Aggregate trade into candles (fire-and-forget to avoid blocking)
    // Don't await - let it run in background so it doesn't delay order processing
    this.candlesService
      .aggregateTradeToCandle(trade, [
        Timeframe.ONE_MINUTE,
        Timeframe.FIVE_MINUTES,
        Timeframe.FIFTEEN_MINUTES,
        Timeframe.THIRTY_MINUTES,
        Timeframe.ONE_HOUR,
        Timeframe.FOUR_HOURS,
        Timeframe.ONE_DAY,
        Timeframe.ONE_WEEK,
      ])
      .then((aggregatedCandles) => {
        // Broadcast candle updates for each timeframe
        for (const [timeframe, candle] of aggregatedCandles) {
          this.wsGateway.broadcastCandleUpdate(market.symbol, timeframe, candle);
        }
      })
      .catch(() => {
        // Silently fail - candle aggregation should not block trade execution
      });

    // 🔥 Emit WebSocket events to notify users about trade execution
    this.wsGateway.emitTradeExecuted({
      tradeId: String(trade.id),
      buyerId: String(buyerUser.id),
      sellerId: String(sellerUser.id),
      symbol: market.symbol,
      price: tradePrice,
      amount: matchedAmount,
      takerSide: takerOrder.side === OrderSide.BUY ? 'BUY' : 'SELL',
    });

    // 🔥 Explicitly broadcast ticker update (don't wait for async)
    // This ensures lastPrice, change24h, volume update immediately
    void this.wsGateway.broadcastTickerUpdate(market.symbol);

    // Emit balance updates to both users
    this.wsGateway.emitBalanceUpdate(String(buyerUser.id));
    this.wsGateway.emitBalanceUpdate(String(sellerUser.id));

    // Broadcast orderbook update to all subscribers (fire-and-forget to avoid blocking)
    // This ensures trade execution completes quickly
    this.wsGateway.broadcastOrderBookUpdate(market.symbol).catch((error) => {
      this.logger.error(`Error broadcasting orderbook update after trade:`, error);
    });
  }
}
