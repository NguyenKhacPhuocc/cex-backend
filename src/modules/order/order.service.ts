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

    // Get wallet first to check balance
    const wallet = await this.walletRepo.findOne({
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
    let amountToLock: number;
    if (type === OrderType.MARKET && side === OrderSide.BUY) {
      // Market BUY order: Lock entire available balance (since we don't know exact price)
      // This ensures we have enough to cover the trade at any price
      amountToLock = Number(wallet.available);

      if (amountToLock <= 0) {
        throw new BadRequestException('Insufficient balance');
      }
    } else {
      // LIMIT order or MARKET SELL: Use calculated amount
      amountToLock = side === OrderSide.BUY ? (price as number) * amount : amount;

      if (!amountToLock || isNaN(amountToLock) || amountToLock <= 0) {
        throw new BadRequestException('Invalid amount to lock');
      }
    }

    if (!wallet || wallet.available < amountToLock) {
      throw new BadRequestException('Insufficient balance');
    }

    // Use WalletCalculationService for balance locking
    this.walletCalculationService.lockBalance(wallet, amountToLock);
    await this.walletRepo.save(wallet);

    try {
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
    } catch (error) {
      // Revert balance lock if order enqueuing fails
      wallet.available = Number(wallet.available) + amountToLock;
      wallet.frozen = Number(wallet.frozen) - amountToLock;
      await this.walletRepo.save(wallet);
      throw error;
    }
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

    if (order.status !== OrderStatus.OPEN) {
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
      const amountToUnlock =
        orderEntity.side === OrderSide.BUY
          ? Number(orderEntity.price) * remainingAmount
          : remainingAmount;

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

      if (wallet) {
        wallet.available = Number(wallet.available) + amountToUnlock;
        wallet.frozen = Number(wallet.frozen) - amountToUnlock;
        await manager.save(wallet);
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

        const remainingAmount = order.amount - order.filled;
        if (remainingAmount <= 0) continue;

        const amount =
          order.side === OrderSide.BUY ? (order.price || 0) * remainingAmount : remainingAmount;
        const currency =
          order.side === OrderSide.BUY ? order.market.quoteAsset : order.market.baseAsset;

        amountsToUnlock.set(currency, (amountsToUnlock.get(currency) || 0) + amount);
      }

      for (const [currency, amount] of amountsToUnlock.entries()) {
        if (amount <= 0) continue;
        const wallet = await manager.findOne(Wallet, {
          where: {
            user: { id: user.id },
            currency,
            walletType: WalletType.SPOT,
          },
        });

        if (wallet) {
          wallet.available = Number(wallet.available) + amount;
          wallet.frozen = Number(wallet.frozen) - amount;
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

        const remainingAmount = order.amount - order.filled;
        if (remainingAmount <= 0) continue;

        const amount =
          order.side === OrderSide.BUY ? (order.price || 0) * remainingAmount : remainingAmount;
        const currency =
          order.side === OrderSide.BUY ? order.market.quoteAsset : order.market.baseAsset;

        amountsToUnlock.set(currency, (amountsToUnlock.get(currency) || 0) + amount);
      }

      for (const [currency, amount] of amountsToUnlock.entries()) {
        if (amount <= 0) continue;
        const wallet = await manager.findOne(Wallet, {
          where: {
            user: { id: user.id },
            currency,
            walletType: WalletType.SPOT,
          },
        });

        if (wallet) {
          wallet.available = Number(wallet.available) + amount;
          wallet.frozen = Number(wallet.frozen) - amount;
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
