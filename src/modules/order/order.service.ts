/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { RedisPubSub } from 'src/core/redis/redis.pubsub';
import { Order } from './entities/order.entity';
import { User } from '../users/entities/user.entity';
import { Market } from '../market/entities/market.entity';
import { MarketService } from '../market/market.service';
import { CreateOrderDto } from './dtos/create-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { OrderBookCacheService } from 'src/core/redis/orderbook-cache.service';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { OrderSide, OrderStatus, OrderType } from 'src/shared/enums';
import { RedisService } from 'src/core/redis/redis.service';
import { REDIS_KEYS } from 'src/common/constants/redis-keys';
import { TradingWebSocketGateway } from 'src/core/websocket/websocket.gateway';
import { WalletCalculationService } from 'src/common/services/wallet-calculation.service';
import { Trade } from '../trades/entities/trade.entity';

@Injectable()
export class OrderService implements OnModuleInit {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly marketService: MarketService,
    private readonly orderBookCache: OrderBookCacheService,
    private readonly orderQueue: OrderQueueService,
    private readonly redisService: RedisService,
    private readonly redisPubSub: RedisPubSub,
    private dataSource: DataSource,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
    @InjectRepository(Trade)
    private tradeRepo: Repository<Trade>,
    @Inject(forwardRef(() => TradingWebSocketGateway))
    private readonly wsGateway: TradingWebSocketGateway,
    private readonly walletCalculationService: WalletCalculationService,
  ) {}

  onModuleInit() {
    this.redisPubSub.subscribe(REDIS_KEYS.ORDER_UPDATE_CHANNEL); // đăng ký kênh lắng nghe cập nhật lệnh
    this.redisPubSub.onMessage(async (channel, message) => {
      if (channel === REDIS_KEYS.ORDER_UPDATE_CHANNEL) {
        const userId = message.userId as string;
        const redisKey = REDIS_KEYS.USER_OPEN_ORDERS(userId);
        await this.redisService.del(redisKey);
      }
    });
  }

  async createOrder(user: User, createOrderDto: CreateOrderDto): Promise<Order> {
    const { side, type, price, amount, marketSymbol, inputAssetType, originalQuoteAmount } =
      createOrderDto;
    const maxRetries = 3;
    let retryCount = 0;
    let wallet: Wallet | null = null;
    let amountToLock: number = 0;

    while (retryCount < maxRetries) {
      try {
        // Validate price is required for LIMIT orders
        if (type === OrderType.LIMIT && (!price || price <= 0)) {
          throw new BadRequestException(
            'Price is required and must be greater than 0 for LIMIT orders',
          );
        }

        // Validate amount
        if (!amount || amount <= 0) {
          throw new BadRequestException('Amount must be greater than 0');
        }

        const market = await this.marketService.findBySymbol(marketSymbol);
        if (!market) {
          throw new NotFoundException(`Market ${marketSymbol} not found`);
        }

        // Validate minimum order size (BTC amount)
        // For market orders with USDT input, amount is already converted to BTC
        if (amount < market.minOrderSize) {
          throw new BadRequestException(
            `Minimum order size is ${market.minOrderSize} ${market.baseAsset}`,
          );
        }

        // Determine which wallet to lock based on side and inputAssetType
        // Default behavior: BUY locks quoteAsset (USDT), SELL locks baseAsset (BTC)
        let currencyToLock: string;
        const walletToLock = WalletType.SPOT;

        // Calculate amount to lock based on order type, side, and inputAssetType
        if (type === OrderType.MARKET) {
          // Market order logic with inputAssetType
          if (side === OrderSide.BUY) {
            // BUY market order
            if (inputAssetType === 'base') {
              // Input is BTC: lock entire USDT balance (buy max BTC)
              currencyToLock = market.quoteAsset;
            } else {
              // Input is USDT (default or explicit): lock specified USDT amount
              currencyToLock = market.quoteAsset;
            }
          } else {
            // SELL market order
            if (inputAssetType === 'quote') {
              // Input is USDT: lock entire BTC balance (sell all to receive USDT)
              currencyToLock = market.baseAsset;
            } else {
              // Input is BTC (default or explicit): lock specified BTC amount
              currencyToLock = market.baseAsset;
            }
          }
        } else {
          // LIMIT order: always lock based on side (inputAssetType doesn't matter for limit orders)
          currencyToLock = side === OrderSide.BUY ? market.quoteAsset : market.baseAsset;
        }

        // Get wallet first to check balance (reload on retry to get latest balance)
        wallet = await this.walletRepo.findOne({
          where: {
            user: { id: user.id },
            currency: currencyToLock,
            walletType: walletToLock,
          },
        });

        if (!wallet) {
          throw new BadRequestException('Wallet not found');
        }

        // Calculate amount to lock based on order type, side, and inputAssetType
        if (type === OrderType.MARKET && side === OrderSide.BUY) {
          // Market BUY order
          if (inputAssetType === 'base') {
            // Input is BTC: lock entire available USDT balance
            // This ensures we have enough to buy the specified BTC amount at any price
            if (wallet.available <= 0) {
              throw new BadRequestException('Insufficient balance');
            }
            amountToLock = wallet.available;
          } else {
            // Input is USDT: lock the specified USDT amount
            // Frontend sends originalQuoteAmount with the original USDT amount
            if (originalQuoteAmount && originalQuoteAmount > 0) {
              amountToLock = Number(originalQuoteAmount);
            } else {
              // Fallback: if originalQuoteAmount not provided, lock all available
              // This shouldn't happen, but handle gracefully
              if (wallet.available <= 0) {
                throw new BadRequestException('Insufficient balance');
              }
              amountToLock = wallet.available;
            }
          }
        } else if (type === OrderType.MARKET && side === OrderSide.SELL) {
          // Market SELL order
          if (inputAssetType === 'quote') {
            // Input is USDT: lock entire available BTC balance
            // This ensures we have enough BTC to sell to receive the specified USDT amount
            if (wallet.available <= 0) {
              throw new BadRequestException('Insufficient balance');
            }
            amountToLock = wallet.available;
          } else {
            // Input is BTC: lock the specified BTC amount
            amountToLock = amount;
          }
        } else {
          // LIMIT order: Use calculated amount with price
          if (!price || price <= 0 || isNaN(price)) {
            throw new BadRequestException('Price is required and must be valid for LIMIT orders');
          }
          amountToLock = side === OrderSide.BUY ? price * amount : amount;
        }

        // Validate amountToLock
        if (!amountToLock || isNaN(amountToLock) || amountToLock <= 0) {
          throw new BadRequestException(`Invalid amount to lock: ${amountToLock}`);
        }

        // --- TẤT CẢ OPERATIONS TRONG MỘT TRANSACTION ĐỂ ĐẢM BẢO ACID ---
        const savedOrder = await this.walletRepo.manager.transaction(
          async (transactionalManager) => {
            // --- 1. Load wallet với pessimistic locking để đảm bảo Isolation ---
            const lockedWallet = await transactionalManager.findOne(Wallet, {
              where: {
                id: wallet!.id, // wallet is already checked above
              },
              lock: { mode: 'pessimistic_write' },
            });

            if (!lockedWallet) {
              throw new BadRequestException('Wallet not found or locked');
            }

            // --- 2. Validate balance trong transaction (đảm bảo Consistency) ---
            if (lockedWallet.available < amountToLock) {
              throw new BadRequestException('Insufficient balance');
            }

            // --- 3. Lock balance trong transaction ---
            this.walletCalculationService.lockBalance(lockedWallet, amountToLock);

            // --- 4. Recalculate balance để đảm bảo Consistency ---
            this.walletCalculationService.recalculateBalance(lockedWallet);

            // --- 5. Validate wallet state ---
            if (!this.walletCalculationService.isValidWallet(lockedWallet)) {
              throw new Error('Invalid wallet state after balance lock');
            }

            // --- 6. Save wallet trong transaction ---
            await transactionalManager.save(lockedWallet);

            // --- 7. Create order trong transaction ---
            const order = transactionalManager.create(Order, {
              user,
              market,
              side,
              type,
              price,
              amount,
              status: OrderStatus.OPEN,
            });
            const savedOrder = await transactionalManager.save(order);

            return savedOrder;
          },
        );

        // Ensure market data is included when enqueuing
        // TypeORM might not return the full market relation, so we explicitly include it
        const orderWithMarket = {
          ...savedOrder,
          market: market,
          user: { id: user.id },
        };
        await this.orderQueue.enqueue(market.symbol, orderWithMarket as any);

        // Emit WebSocket event immediately after order creation
        // This allows frontend to show order in "pending orders" table immediately
        // without waiting for matching engine to process it
        this.wsGateway.emitOrderUpdate(String(user.id), savedOrder.id, OrderStatus.OPEN);

        // Publish message to invalidate cache for user's open orders
        await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
          userId: user.id,
        });

        return savedOrder;
      } catch (error: unknown) {
        // Check if it's a deadlock error (PostgreSQL error code 40P01)
        const errorObj = error as {
          code?: string;
          driverError?: { code?: string };
          message?: string;
        };
        const isDeadlock =
          errorObj?.code === '40P01' ||
          errorObj?.driverError?.code === '40P01' ||
          (typeof errorObj?.message === 'string' && errorObj.message.includes('deadlock'));

        if (isDeadlock && retryCount < maxRetries - 1) {
          retryCount++;
          // Wait random time between 50-200ms before retry (exponential backoff)
          const delay = Math.random() * 150 + 50;
          await new Promise((resolve) => setTimeout(resolve, delay * retryCount));
          this.logger.warn(
            `Deadlock detected for order creation (user: ${user.id}, market: ${marketSymbol}), retrying... (${retryCount}/${maxRetries})`,
          );
          // Note: No need to unlock balance - transaction will rollback automatically
          continue;
        }

        // Note: No need to manually unlock balance - transaction rollback handles it automatically
        // If transaction fails, all changes (wallet lock, order creation) are rolled back
        throw error;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error('Order creation failed after max retries');
  }

  async getUserOrdersIsOpen(user: User): Promise<Order[]> {
    const redisKey = REDIS_KEYS.USER_OPEN_ORDERS(user.id);
    const cachedOrders = await this.redisService.get(redisKey);

    if (cachedOrders) {
      return JSON.parse(cachedOrders);
    }
    const dbOrders = await this.orderRepo.find({
      where: {
        user: { id: user.id },
        status: In([OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED]),
      },
      relations: ['market'], // nếu muốn lấy thêm thông tin market
      order: { createdAt: 'DESC' },
    });

    // Serialize Date fields to ISO string for proper JSON serialization
    const serializedOrders = dbOrders.map((order) => ({
      ...order,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
    })) as any as Order[];

    // Cache the result in Redis with a TTL (e.g., 5 minutes)
    await this.redisService.set(redisKey, JSON.stringify(serializedOrders), 300);

    return serializedOrders;
  }

  async getUserOrderHistory(
    user: User,
    pagination: { page?: number; limit?: number } = { page: 1, limit: 20 },
  ): Promise<{
    data: Order[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    const [orders, total] = await this.orderRepo.findAndCount({
      where: {
        user: { id: user.id },
        status: Not(In([OrderStatus.OPEN])),
      },
      relations: ['market'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    // Serialize Date fields to ISO string for proper JSON serialization
    const data = orders.map((order) => ({
      ...order,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
    })) as any as Order[];

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrderById(user: User, orderId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: {
        id: orderId,
        user: { id: user.id },
      },
      relations: ['market'],
    });
    if (!order) {
      throw new NotFoundException(`Order not found`);
    }
    // Serialize Date fields to ISO string for proper JSON serialization
    return {
      ...order,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
    } as any as Order;
  }

  async cancelOrder(user: User, orderId: string) {
    const order = await this.getOrderById(user, orderId);

    if (order.status !== OrderStatus.OPEN && order.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new BadRequestException(`Cannot cancel order with status ${order.status}`);
    }

    // Gửi tín hiệu đến matching engine để xóa khỏi orderbook
    await this.redisPubSub.publish(
      REDIS_KEYS.ORDER_CANCEL_CHANNEL,
      order as unknown as Record<string, unknown>,
    );

    // --- TẤT CẢ OPERATIONS TRONG MỘT TRANSACTION ĐỂ ĐẢM BẢO ACID ---
    await this.dataSource.transaction(async (manager) => {
      // --- 1. Reload order entity với lock để đảm bảo Isolation ---
      // Không load relations trong query có lock để tránh lỗi "FOR UPDATE cannot be applied to the nullable side of an outer join"
      const orderEntity = await manager.findOne(Order, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' }, // Lock order to prevent concurrent cancellation
      });

      if (!orderEntity) {
        throw new NotFoundException(`Order not found`);
      }

      // Load market relation riêng sau khi đã lock order
      // Sử dụng market từ order ban đầu (đã có market relation từ getOrderById)
      if (!order.market?.id) {
        throw new NotFoundException(`Market not found for order ${orderId}`);
      }
      const market = await manager.findOne(Market, {
        where: { id: order.market.id },
      });
      if (!market) {
        throw new NotFoundException(`Market not found for order ${orderId}`);
      }
      orderEntity.market = market;

      // --- 2. Validate order status ---
      if (
        orderEntity.status !== OrderStatus.OPEN &&
        orderEntity.status !== OrderStatus.PARTIALLY_FILLED
      ) {
        throw new BadRequestException(`Cannot cancel order with status ${orderEntity.status}`);
      }

      const remainingAmount = Number(orderEntity.amount) - Number(orderEntity.filled);

      // Determine currency to unlock
      const currencyToUnlock =
        orderEntity.side === OrderSide.BUY
          ? orderEntity.market.quoteAsset
          : orderEntity.market.baseAsset;

      // --- 3. Load wallet với pessimistic locking để đảm bảo Isolation ---
      const wallet = await manager.findOne(Wallet, {
        where: {
          user: { id: user.id },
          currency: currencyToUnlock,
          walletType: WalletType.SPOT,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        this.logger.warn(`Wallet not found for order ${orderEntity.id}, skipping unlock`);
      } else {
        let amountToUnlock: number;

        if (orderEntity.type === OrderType.MARKET) {
          // For market orders: Calculate exact frozen balance for THIS order only
          // We need to exclude frozen balance from other open orders

          // Get all other open orders for the same user and currency
          const otherOpenOrders = await manager.find(Order, {
            where: {
              user: { id: user.id },
              market: { id: orderEntity.market.id },
              status: In([OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED]),
              id: Not(orderEntity.id), // Exclude current order
            },
            relations: ['market'],
          });

          // Calculate total frozen balance locked by other orders
          let totalFrozenFromOtherOrders = 0;
          for (const otherOrder of otherOpenOrders) {
            if (otherOrder.side === OrderSide.BUY) {
              // BUY orders lock quoteAsset
              if (otherOrder.market.quoteAsset === currencyToUnlock) {
                if (otherOrder.type === OrderType.MARKET) {
                  // Market BUY: Cannot calculate exactly, but we'll handle it
                  // For now, skip calculation for market orders
                } else {
                  // LIMIT BUY: price * remainingAmount
                  const otherRemaining = Number(otherOrder.amount) - Number(otherOrder.filled);
                  if (otherOrder.price && otherRemaining > 0) {
                    totalFrozenFromOtherOrders += Number(otherOrder.price) * otherRemaining;
                  }
                }
              }
            } else {
              // SELL orders lock baseAsset
              if (otherOrder.market.baseAsset === currencyToUnlock) {
                const otherRemaining = Number(otherOrder.amount) - Number(otherOrder.filled);
                totalFrozenFromOtherOrders += otherRemaining;
              }
            }
          }

          // Calculate frozen balance for THIS order
          const currentFrozenBalance = Number(wallet.frozen);

          if (orderEntity.side === OrderSide.BUY) {
            // Market BUY: Calculate frozen balance from trades
            // Total tradeValue used = sum(trade.price * trade.amount) for this order
            const trades = await manager.find(Trade, {
              where: { buyOrder: { id: orderEntity.id } },
            });

            let totalTradeValueUsed = 0;
            for (const trade of trades) {
              totalTradeValueUsed += Number(trade.price) * Number(trade.amount);
            }

            // Frozen balance for THIS order = current frozen - other orders' frozen
            // But we also know: original frozen = current frozen + totalTradeValueUsed
            // So: frozen for this order = current frozen - other orders' frozen
            if (currentFrozenBalance > totalFrozenFromOtherOrders) {
              amountToUnlock = currentFrozenBalance - totalFrozenFromOtherOrders;
            } else {
              // If calculation shows no frozen left, but we know trades were made,
              // it means all frozen was used. But we should still unlock any remaining.
              // This shouldn't happen normally, but handle gracefully
              this.logger.warn(
                `Market BUY order ${orderEntity.id}: frozen balance calculation issue. Current: ${currentFrozenBalance}, Other orders: ${totalFrozenFromOtherOrders}, TradeValue used: ${totalTradeValueUsed}`,
              );
              // Unlock whatever is left (should be 0 or very small)
              amountToUnlock = Math.max(0, currentFrozenBalance - totalFrozenFromOtherOrders);
            }
          } else {
            // Market SELL: Unlock remaining frozen balance
            // Note: For SELL market orders with input USDT, we locked the entire BTC balance
            // But order.amount only represents the estimated BTC needed
            // So we need to unlock all remaining frozen balance (after excluding other orders' frozen)
            // The actual BTC used in trades has already been subtracted from frozen
            if (currentFrozenBalance > totalFrozenFromOtherOrders) {
              // Unlock all frozen balance that belongs to this order
              // Don't limit by remainingAmount because we may have locked more than order.amount
              amountToUnlock = currentFrozenBalance - totalFrozenFromOtherOrders;
            } else {
              // If current frozen is less than other orders' frozen, it means
              // this order's frozen was already used or there's a calculation issue
              // Unlock whatever is left (should be 0 or very small)
              amountToUnlock = 0;
              this.logger.warn(
                `Market SELL order ${orderEntity.id}: frozen balance calculation issue. Current: ${currentFrozenBalance}, Other orders: ${totalFrozenFromOtherOrders}, remaining: ${remainingAmount}`,
              );
            }
          }

          // Safety check: amountToUnlock should not exceed current frozen balance
          if (amountToUnlock > currentFrozenBalance) {
            this.logger.warn(
              `Calculated unlock amount ${amountToUnlock} exceeds frozen balance ${currentFrozenBalance} for order ${orderEntity.id}, using frozen balance`,
            );
            amountToUnlock = currentFrozenBalance;
          }
        } else {
          // For LIMIT orders: Calculate unlock amount based on price
          // Validate price for LIMIT BUY orders
          if (
            orderEntity.side === OrderSide.BUY &&
            (!orderEntity.price ||
              isNaN(Number(orderEntity.price)) ||
              Number(orderEntity.price) <= 0)
          ) {
            this.logger.error(
              `Cannot cancel LIMIT BUY order ${orderEntity.id}: invalid price ${orderEntity.price}`,
            );
            throw new BadRequestException('Invalid order price');
          }

          amountToUnlock =
            orderEntity.side === OrderSide.BUY
              ? Number(orderEntity.price) * remainingAmount
              : remainingAmount;
        }

        // --- 4. Unlock balance nếu amount hợp lệ ---
        if (amountToUnlock > 0 && !isNaN(amountToUnlock)) {
          this.walletCalculationService.unlockBalance(wallet, amountToUnlock);

          // --- 5. Recalculate balance để đảm bảo Consistency ---
          this.walletCalculationService.recalculateBalance(wallet);

          // --- 6. Validate wallet state ---
          if (!this.walletCalculationService.isValidWallet(wallet)) {
            throw new Error('Invalid wallet state after balance unlock');
          }

          // --- 7. Save wallet trong transaction ---
          await manager.save(wallet);
          this.logger.log(
            `Unlocked ${amountToUnlock} ${currencyToUnlock} for canceled ${orderEntity.type} ${orderEntity.side} order ${orderEntity.id}`,
          );
        } else {
          this.logger.warn(
            `Invalid amountToUnlock for order ${orderEntity.id}: ${amountToUnlock}, skipping wallet update`,
          );
        }
      }

      // --- 8. Update order status trong transaction ---
      orderEntity.status = OrderStatus.CANCELED;
      await manager.save(orderEntity);
    });

    // Thông báo cập nhật UI
    await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
      userId: user.id,
    });

    // Emit WebSocket event to notify user about order cancellation
    this.wsGateway.emitOrderUpdate(String(user.id), orderId, OrderStatus.CANCELED);

    return {
      code: 'success',
      message: `Order ${orderId} canceled successfully.`,
    };
  }

  async cancelOrdersBySymbolAndSide(user: User, symbol: string, side: OrderSide): Promise<number> {
    const market = await this.marketService.findBySymbol(symbol);
    if (!market) {
      return 0;
    }

    const openOrders = await this.orderRepo.find({
      where: {
        user: { id: user.id },
        status: OrderStatus.OPEN,
        side,
        market: { id: market.id },
      },
      relations: ['market'],
    });

    if (openOrders.length === 0) {
      return 0;
    }

    // --- TẤT CẢ OPERATIONS TRONG MỘT TRANSACTION ĐỂ ĐẢM BẢO ACID ---
    await this.dataSource.transaction(async (manager) => {
      const amountsToUnlock = new Map<string, number>();

      for (const order of openOrders) {
        await this.redisPubSub.publish(
          REDIS_KEYS.ORDER_CANCEL_CHANNEL,
          order as unknown as Record<string, unknown>,
        );
        order.status = OrderStatus.CANCELED;

        const remainingAmount = Number(order.amount) - Number(order.filled);
        if (remainingAmount <= 0 || isNaN(remainingAmount)) continue;

        // Validate price for BUY orders
        let amount = 0;
        if (order.side === OrderSide.BUY) {
          if (!order.price || isNaN(Number(order.price)) || Number(order.price) <= 0) {
            this.logger.warn(`Skipping order ${order.id}: invalid price ${order.price}`);
            continue;
          }
          amount = Number(order.price) * remainingAmount;
        } else {
          amount = remainingAmount;
        }

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
          this.logger.warn(`Skipping order ${order.id}: invalid amount ${amount}`);
          continue;
        }

        const currency =
          order.side === OrderSide.BUY ? order.market.quoteAsset : order.market.baseAsset;

        amountsToUnlock.set(currency, (amountsToUnlock.get(currency) || 0) + amount);
      }

      for (const [currency, amount] of amountsToUnlock.entries()) {
        if (amount <= 0 || isNaN(amount)) continue;
        // --- Load wallet với pessimistic locking để đảm bảo Isolation ---
        const wallet = await manager.findOne(Wallet, {
          where: {
            user: { id: user.id },
            currency,
            walletType: WalletType.SPOT,
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (wallet) {
          this.walletCalculationService.unlockBalance(wallet, amount);

          // Recalculate balance để đảm bảo Consistency
          this.walletCalculationService.recalculateBalance(wallet);

          // Validate wallet state
          if (!this.walletCalculationService.isValidWallet(wallet)) {
            throw new Error(`Invalid wallet state after balance unlock for ${currency}`);
          }

          await manager.save(wallet);
        }
      }

      // --- Save orders trong transaction ---
      await manager.save(openOrders);
    });

    await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
      userId: user.id,
    });

    // Emit WebSocket events for each canceled order
    for (const order of openOrders) {
      this.wsGateway.emitOrderUpdate(String(user.id), order.id, OrderStatus.CANCELED);
    }

    return openOrders.length;
  }

  async cancelAllOrders(user: User) {
    const openOrders = await this.orderRepo.find({
      where: {
        user: { id: user.id },
        status: OrderStatus.OPEN,
      },
      relations: ['market'],
    });

    if (openOrders.length === 0) {
      return { code: 'success', message: 'No open orders to cancel.' };
    }

    await this.dataSource.transaction(async (manager) => {
      const amountsToUnlock = new Map<string, number>();

      for (const order of openOrders) {
        await this.redisPubSub.publish(
          REDIS_KEYS.ORDER_CANCEL_CHANNEL,
          order as unknown as Record<string, unknown>,
        );
        order.status = OrderStatus.CANCELED;

        const remainingAmount = Number(order.amount) - Number(order.filled);
        if (remainingAmount <= 0 || isNaN(remainingAmount)) continue;

        // Validate price for BUY orders
        let amount = 0;
        if (order.side === OrderSide.BUY) {
          if (!order.price || isNaN(Number(order.price)) || Number(order.price) <= 0) {
            this.logger.warn(`Skipping order ${order.id}: invalid price ${order.price}`);
            continue;
          }
          amount = Number(order.price) * remainingAmount;
        } else {
          amount = remainingAmount;
        }

        // Validate amount
        if (isNaN(amount) || amount <= 0) {
          this.logger.warn(`Skipping order ${order.id}: invalid amount ${amount}`);
          continue;
        }

        const currency =
          order.side === OrderSide.BUY ? order.market.quoteAsset : order.market.baseAsset;

        amountsToUnlock.set(currency, (amountsToUnlock.get(currency) || 0) + amount);
      }

      for (const [currency, amount] of amountsToUnlock.entries()) {
        if (amount <= 0 || isNaN(amount)) continue;
        const wallet = await manager.findOne(Wallet, {
          where: {
            user: { id: user.id },
            currency,
            walletType: WalletType.SPOT,
          },
        });

        if (wallet) {
          this.walletCalculationService.unlockBalance(wallet, amount);
          await manager.save(wallet);
        }
      }

      await manager.save(openOrders);
    });

    await this.redisPubSub.publish(REDIS_KEYS.ORDER_UPDATE_CHANNEL, {
      userId: user.id,
    });

    // Emit WebSocket events for each canceled order
    for (const order of openOrders) {
      this.wsGateway.emitOrderUpdate(String(user.id), order.id, OrderStatus.CANCELED);
    }

    return {
      code: 'success',
      message: `All ${openOrders.length} open orders canceled successfully.`,
    };
  }
}
