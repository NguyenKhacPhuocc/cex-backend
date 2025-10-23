import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Order } from './entities/order.entity';
import { User } from '../users/entities/user.entity';
import { MarketService } from '../market/market.service';
import { CreateOrderDto } from './dtos/create-order.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderBookCacheService } from 'src/core/redis/orderbook-cache.service';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { OrderQueueService } from 'src/core/redis/order-queue.service';
import { OrderSide, OrderStatus } from 'src/shared/enums';

@Injectable()
export class OrderService {
  constructor(
    private readonly marketService: MarketService,
    private readonly orderBookCache: OrderBookCacheService,
    private readonly orderQueue: OrderQueueService,
    @InjectRepository(Order)
    private orderRepo: Repository<Order>,
    @InjectRepository(Wallet)
    private walletRepo: Repository<Wallet>,
  ) {}

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
      return savedOrder;
    } catch (error) {
      // Revert balance lock if order enqueuing fails
      wallet.available = Number(wallet.available) + amountToLock;
      wallet.frozen = Number(wallet.frozen) - amountToLock;
      await this.walletRepo.save(wallet);
      throw error;
    }
  }
}
