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
    const { side, type, price, amount, marketSymbol } = createOrderDto;
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

        // Balance check and locking
        const walletToLock = WalletType.SPOT;
        const currencyToLock = side === OrderSide.BUY ? market.quoteAsset : market.baseAsset;

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

        // Calculate amount to lock
        if (type === OrderType.MARKET && side === OrderSide.BUY) {
          // Market BUY order: Lock entire available balance (since we don't know exact price)
          // This ensures we have enough to cover the trade at any price
          if (!wallet || wallet.available <= 0) {
            throw new BadRequestException('Insufficient balance');
          }
          // Lock entire available balance for market BUY orders
          amountToLock = wallet.available;
        } else if (type === OrderType.MARKET && side === OrderSide.SELL) {
          // Market SELL order: Lock the base asset amount
          amountToLock = amount;
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

        if (!wallet || wallet.available < amountToLock) {
          throw new BadRequestException('Insufficient balance');
        }

        // Use WalletCalculationService for balance locking
        this.walletCalculationService.lockBalance(wallet, amountToLock);
        await this.walletRepo.save(wallet);

        const order = this.orderRepo.create({
          user,
          market,
          side,
          type,
          price,
          amount,
          status: OrderStatus.OPEN,
        });
        const savedOrder = await this.orderRepo.save(order);

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
          // Revert balance lock if it was set before retry
          if (wallet && amountToLock > 0) {
            try {
              this.walletCalculationService.unlockBalance(wallet, amountToLock);
              await this.walletRepo.save(wallet);
            } catch {
              // Ignore unlock errors during retry
            }
          }
          continue;
        }

        // Revert balance lock if order creation fails (not a retryable deadlock)
        if (wallet && amountToLock > 0) {
          try {
            this.walletCalculationService.unlockBalance(wallet, amountToLock);
            await this.walletRepo.save(wallet);
          } catch (unlockError) {
            this.logger.error(`Failed to unlock balance after order creation error:`, unlockError);
          }
        }
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

  async getUserOrderHistory(user: User): Promise<Order[]> {
    const orders = await this.orderRepo.find({
      where: {
        user: { id: user.id },
        status: Not(In([OrderStatus.OPEN])),
      },
      relations: ['market'],
      order: { createdAt: 'DESC' },
      take: 50, // Pagination to prevent loading too many records
    });
    // Serialize Date fields to ISO string for proper JSON serialization
    return orders.map((order) => ({
      ...order,
      createdAt: order.createdAt ? new Date(order.createdAt).toISOString() : null,
      updatedAt: order.updatedAt ? new Date(order.updatedAt).toISOString() : null,
    })) as any as Order[];
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

    // Transaction đảm bảo đồng bộ
    await this.dataSource.transaction(async (manager) => {
      // Reload order entity in transaction to ensure it's a proper entity instance
      const orderEntity = await manager.findOne(Order, {
        where: { id: orderId },
        relations: ['market'],
      });

      if (!orderEntity) {
        throw new NotFoundException(`Order not found`);
      }

      orderEntity.status = OrderStatus.CANCELED;
      await manager.save(orderEntity);

      const remainingAmount = Number(orderEntity.amount) - Number(orderEntity.filled);

      // Determine currency to unlock
      const currencyToUnlock =
        orderEntity.side === OrderSide.BUY
          ? orderEntity.market.quoteAsset
          : orderEntity.market.baseAsset;

      const wallet = await manager.findOne(Wallet, {
        where: {
          user: { id: user.id },
          currency: currencyToUnlock,
          walletType: WalletType.SPOT,
        },
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
            // Market SELL: remainingAmount is exact (baseAsset)
            // But need to exclude other orders' frozen
            if (currentFrozenBalance > totalFrozenFromOtherOrders) {
              amountToUnlock = Math.min(
                currentFrozenBalance - totalFrozenFromOtherOrders,
                remainingAmount,
              );
            } else {
              amountToUnlock = remainingAmount;
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

        // Unlock balance if amount is valid
        if (amountToUnlock > 0 && !isNaN(amountToUnlock)) {
          this.walletCalculationService.unlockBalance(wallet, amountToUnlock);
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
