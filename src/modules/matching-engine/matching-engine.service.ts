import { Injectable, Logger } from '@nestjs/common';
import { Order } from 'src/modules/order/entities/order.entity';
import { OrderSide, OrderStatus, OrderType } from 'src/shared/enums';
import { OrderBookService } from '../trading/order-book.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { Market } from 'src/modules/market/entities/market.entity';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { Trade } from '../trades/entities/trade.entity';

@Injectable()
export class MatchingEngineService {
  private readonly logger = new Logger(MatchingEngineService.name);

  constructor(
    private readonly orderBookService: OrderBookService,
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
  ) {}

  async processOrder(order: Order): Promise<void> {
    this.logger.log(`Processing order: ${order.id}`);

    // Eagerly load full User and Market entities for the order
    const fullUser = await this.userRepo.findOne({
      where: { id: order.user.id },
    });
    const fullMarket = await this.marketRepo.findOne({
      where: { id: order.market.id },
    });

    if (!fullUser || !fullMarket) {
      this.logger.error(
        `Failed to load full user or market for order ${order.id}. Skipping processing.`,
      );
      return;
    }

    order.user = fullUser;
    order.market = fullMarket;

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
    this.logger.log(
      `Order ${newOrderEntity.id} saved to DB with status ${newOrderEntity.status}`,
    );
  }

  private async processLimitOrder(order: Order): Promise<number> {
    const oppositeSide =
      order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    let remainingAmount = order.amount;

    while (remainingAmount > 0) {
      // tìm kiếm order tốt nhất từ bên đối diện
      const bestMatch = await this.orderBookService.getBest(
        order.market.symbol,
        oppositeSide,
      );

      if (!bestMatch) {
        break; // No match found, break the loop
      }

      // Prevent self-matching
      if (bestMatch.user.id === order.user.id) {
        // Remove this order from book and continue searching
        await this.orderBookService.remove(bestMatch);
        continue;
      }

      const canMatch =
        order.side === OrderSide.BUY
          ? Number(order.price) >= Number(bestMatch.price)
          : Number(order.price) <= Number(bestMatch.price);

      if (!canMatch) {
        break; // Price does not match
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
    }

    if (Number(remainingAmount) > 0) {
      // If the incoming order is partially filled and still has remaining amount, add it to the order book.
      await this.orderBookService.add(order);
    }
    return Number(remainingAmount);
  }

  private async processMarketOrder(order: Order): Promise<number> {
    const oppositeSide =
      order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    let remainingAmount = order.amount;

    while (Number(remainingAmount) > 0) {
      const bestMatch = await this.orderBookService.getBest(
        order.market.symbol,
        oppositeSide,
      );

      if (!bestMatch) {
        this.logger.warn(
          `No match found for market order ${order.id}. Order may be partially filled or not filled at all.`,
        );
        break; // No match found
      }

      // Prevent self-matching
      if (bestMatch.user.id === order.user.id) {
        // Remove this order from book and continue searching
        await this.orderBookService.remove(bestMatch);
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
    }
    return Number(remainingAmount);
  }

  private async executeTrade(
    takerOrder: Order,
    makerOrder: Order,
    matchedAmount: number,
  ): Promise<void> {
    // --- Load user và market đầy đủ ---
    const [fullTakerUser, fullMakerUser, fullTakerMarket, fullMakerMarket] =
      await Promise.all([
        this.userRepo.findOne({ where: { id: takerOrder.user.id } }),
        this.userRepo.findOne({ where: { id: makerOrder.user.id } }),
        this.marketRepo.findOne({ where: { id: takerOrder.market.id } }),
        this.marketRepo.findOne({ where: { id: makerOrder.market.id } }),
      ]);

    if (
      !fullTakerUser ||
      !fullMakerUser ||
      !fullTakerMarket ||
      !fullMakerMarket
    ) {
      this.logger.error('Failed to load full user or market entities.');
      return;
    }

    takerOrder.user = fullTakerUser;
    makerOrder.user = fullMakerUser;
    takerOrder.market = fullTakerMarket;
    makerOrder.market = fullMakerMarket;

    // Prevent self-trade (should not happen, but double check)
    if (takerOrder.user.id === makerOrder.user.id) {
      this.logger.error(
        `Self-trade detected in executeTrade for user ${takerOrder.user.id}. Trade aborted.`,
      );
      return;
    }

    const tradePrice = Number(makerOrder.price);
    const tradeValue = tradePrice * Number(matchedAmount);

    // --- Ghi bản ghi Trade ---
    const buyOrder =
      takerOrder.side === OrderSide.BUY ? takerOrder : makerOrder;
    const sellOrder =
      takerOrder.side === OrderSide.SELL ? takerOrder : makerOrder;

    const trade = this.tradeRepo.create({
      market: takerOrder.market,
      price: tradePrice,
      amount: matchedAmount,
      buyOrder,
      sellOrder,
      buyer: buyOrder.user,
      seller: sellOrder.user,
    });
    await this.tradeRepo.save(trade);
    this.logger.log(
      `Trade ${trade.id} executed: ${matchedAmount} @ ${tradePrice}`,
    );

    // --- Xác định buyer/seller và ví liên quan ---
    const buyerUser = buyOrder.user;
    const sellerUser = sellOrder.user;
    const market = takerOrder.market;

    const [
      buyerQuoteWallet,
      buyerBaseWallet,
      sellerBaseWallet,
      sellerQuoteWallet,
    ] = await Promise.all([
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

    if (
      !buyerQuoteWallet ||
      !buyerBaseWallet ||
      !sellerBaseWallet ||
      !sellerQuoteWallet
    ) {
      this.logger.error('One or more wallets not found for trade execution.');
      return;
    }

    // --- Cập nhật ví khi có 2 user khác nhau ---
    if (takerOrder.side === OrderSide.BUY) {
      // Buyer (taker)
      buyerQuoteWallet.frozen =
        Number(buyerQuoteWallet.frozen) - Number(tradeValue);
      buyerBaseWallet.available =
        Number(buyerBaseWallet.available) + Number(matchedAmount);

      // Seller (maker)
      sellerBaseWallet.frozen =
        Number(sellerBaseWallet.frozen) - Number(matchedAmount);
      sellerQuoteWallet.available =
        Number(sellerQuoteWallet.available) + Number(tradeValue);
    } else if (takerOrder.side === OrderSide.SELL) {
      // Seller (taker)
      sellerBaseWallet.frozen =
        Number(sellerBaseWallet.frozen) - Number(matchedAmount);
      sellerQuoteWallet.available =
        Number(sellerQuoteWallet.available) + Number(tradeValue);

      // Buyer (maker)
      buyerQuoteWallet.frozen =
        Number(buyerQuoteWallet.frozen) - Number(tradeValue);
      buyerBaseWallet.available =
        Number(buyerBaseWallet.available) + Number(matchedAmount);
    }

    // Đảm bảo không có giá trị âm
    buyerQuoteWallet.frozen = Math.max(0, buyerQuoteWallet.frozen);
    buyerBaseWallet.available = Math.max(0, buyerBaseWallet.available);
    sellerBaseWallet.frozen = Math.max(0, sellerBaseWallet.frozen);
    sellerQuoteWallet.available = Math.max(0, sellerQuoteWallet.available);

    // --- Cập nhật lại balance ---
    buyerQuoteWallet.balance =
      Number(buyerQuoteWallet.available) + Number(buyerQuoteWallet.frozen);
    buyerBaseWallet.balance =
      Number(buyerBaseWallet.available) + Number(buyerBaseWallet.frozen);
    sellerBaseWallet.balance =
      Number(sellerBaseWallet.available) + Number(sellerBaseWallet.frozen);
    sellerQuoteWallet.balance =
      Number(sellerQuoteWallet.available) + Number(sellerQuoteWallet.frozen);

    // --- Kiểm tra an toàn ---
    for (const w of [
      buyerQuoteWallet,
      buyerBaseWallet,
      sellerBaseWallet,
      sellerQuoteWallet,
    ]) {
      if (w.frozen < 0 || w.available < 0) {
        this.logger.error(`Wallet ${w.id} negative after trade`);
        return;
      }
    }

    // --- Ghi thay đổi vào DB ---
    await this.walletRepo.save([
      buyerQuoteWallet,
      buyerBaseWallet,
      sellerBaseWallet,
      sellerQuoteWallet,
    ]);

    this.logger.log(`Wallets updated for trade ${trade.id}`);
  }
}
