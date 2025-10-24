/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { RedisPubSub } from 'src/core/redis/redis.pubsub';
import { Order } from './entities/order.entity';
import { User } from '../users/entities/user.entity';
import { MarketService } from '../market/market.service';
import { CreateOrderDto } from './dtos/create-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { OrderBookCacheService } from 'src/core/redis/orderbook-cache.service';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { OrderSide, OrderStatus } from 'src/shared/enums';
import { RedisService } from 'src/core/redis/redis.service';
import { REDIS_KEYS } from 'src/common/constants/redis-keys';

@Injectable()
export class OrderService implements OnModuleInit {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly marketService: MarketService,
    private readonly orderBookCache: OrderBookCacheService,
    private readonly orderQueue: OrderQueueService,
    private readonly redisService: RedisService,
    private readonly redisPubSub: RedisPubSub,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
  ) {}

  onModuleInit() {
    this.logger.log(
      `[OrderService] Subscribing to channel: ${REDIS_KEYS.ORDER_UPDATE_CHANNEL}`,
    );
    this.redisPubSub.subscribe(REDIS_KEYS.ORDER_UPDATE_CHANNEL); // đăng ký kênh lắng nghe cập nhật lệnh
    this.redisPubSub.onMessage(async (channel, message) => {
      if (channel === REDIS_KEYS.ORDER_UPDATE_CHANNEL) {
        const userId = message.userId;
        this.logger.log(
          `[OrderService] Received message for userId: ${userId}`,
        );
        const redisKey = REDIS_KEYS.USER_OPEN_ORDERS(userId);
        this.logger.log(
          `[OrderService] Attempting to delete cache key: ${redisKey}`,
        );
        const deleteResult = await this.redisService.del(redisKey);
        this.logger.log(
          `[OrderService] Deleted cache key: ${redisKey}, Result: ${deleteResult}`,
        );
      }
    });
  }

  async createOrder(
    user: User,
    createOrderDto: CreateOrderDto,
  ): Promise<Order> {
    const { side, type, price, amount, marketSymbol } = createOrderDto;

    const market = await this.marketService.findBySymbol(marketSymbol);
    if (!market) {
      throw new NotFoundException(`Market ${marketSymbol} not found`);
    }

    // Balance check and locking
    const walletToLock = WalletType.SPOT;
    const currencyToLock =
      side === OrderSide.BUY ? market.quoteAsset : market.baseAsset;
    const amountToLock =
      side === OrderSide.BUY ? (price as number) * amount : amount;

    const wallet = await this.walletRepo.findOne({
      where: {
        user: { id: user.id },
        currency: currencyToLock,
        walletType: walletToLock,
      },
    });

    if (!wallet || wallet.available < amountToLock) {
      throw new BadRequestException('Insufficient balance');
    }

    wallet.available = Number(wallet.available) - amountToLock;
    wallet.frozen = Number(wallet.frozen) + amountToLock;
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
      await this.orderQueue.enqueue(market.symbol, savedOrder);

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

  // lấy các lệnh đang mở của user, Lấy tất cả lệnh đang mở của user Lọc status = open từ Redis trước, fallback DB.
  async getUserOrdersIsOpen(user: User): Promise<Order[]> {
    const redisKey = REDIS_KEYS.USER_OPEN_ORDERS(user.id);
    const cachedOrders = await this.redisService.get(redisKey);

    if (cachedOrders) {
      this.logger.log(
        `[OrderService] Cache HIT for user ${user.id}, key: ${redisKey}`,
      );
      return JSON.parse(cachedOrders);
    }

    this.logger.log(
      `[OrderService] Cache MISS for user ${user.id}, key: ${redisKey}. Fetching from DB.`,
    );
    const dbOrders = await this.orderRepo.find({
      where: {
        user: { id: user.id },
        status: OrderStatus.OPEN,
      },
      relations: ['market'], // nếu muốn lấy thêm thông tin market
      order: { createdAt: 'DESC' },
    });

    this.logger.log(
      `[OrderService] Fetched ${dbOrders.length} orders from DB for user ${user.id}. Orders: ${JSON.stringify(dbOrders.map((o) => ({ id: o.id, status: o.status })))}`,
    );

    // Cache the result in Redis with a TTL (e.g., 5 minutes)
    await this.redisService.set(redisKey, JSON.stringify(dbOrders), 300);
    this.logger.log(
      `[OrderService] Cached ${dbOrders.length} orders for user ${user.id}, key: ${redisKey}`,
    );

    return dbOrders;
  }

  async getUserOrderHistory(user: User): Promise<Order[]> {
    const orders = await this.orderRepo.find({
      where: {
        user: { id: user.id },
        status: Not(OrderStatus.OPEN),
      },
      relations: ['market'], // nếu muốn lấy thêm thông tin market
      order: { createdAt: 'DESC' },
    });
    return orders;
  }
}
