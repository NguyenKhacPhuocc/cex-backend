import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import Redis from 'ioredis';
import { Trade } from '../trades/entities/trade.entity';
import { Order } from '../order/entities/order.entity';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { Market } from '../market/entities/market.entity';

@Injectable()
export class DevService {
  private readonly logger = new Logger(DevService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Market)
    private readonly marketRepository: Repository<Market>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
    private readonly dataSource: DataSource,
  ) {}

  async resetDatabase(): Promise<void> {
    this.logger.warn('🔥 Starting database reset...');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Step 1: Clear Redis
      this.logger.log('📦 Clearing Redis...');
      await this.clearRedis();

      // Step 2: Delete trades (has FK to orders)
      this.logger.log('🗑️ Deleting trades...');
      await queryRunner.query('DELETE FROM trades');

      // Step 3: Delete orders
      this.logger.log('🗑️ Deleting orders...');
      await queryRunner.query('DELETE FROM orders');

      // Step 4: Delete ledger_entries
      this.logger.log('🗑️ Deleting ledger entries...');
      await queryRunner.query('DELETE FROM ledger_entries');

      // Step 5: Delete transactions
      this.logger.log('🗑️ Deleting transactions...');
      await queryRunner.query('DELETE FROM transactions');

      // Step 6: Reset wallets to initial values
      this.logger.log('🔄 Resetting wallets...');
      await this.resetWallets(queryRunner);

      await queryRunner.commitTransaction();
      this.logger.log('✅ Database reset completed successfully!');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('❌ Database reset failed:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async clearRedis(): Promise<void> {
    try {
      // Log all keys before clearing
      const allKeysBefore = await this.redis.keys('*');
      this.logger.log(`📦 Found ${allKeysBefore.length} keys in Redis before clearing`);
      if (allKeysBefore.length > 0) {
        this.logger.log(`Keys: ${allKeysBefore.join(', ')}`);
      }

      // Get all markets to clear their order books
      const markets = await this.marketRepository.find();

      for (const market of markets) {
        const symbol = market.symbol;

        // Clear order books (ZSETs for sorted orders)
        await this.redis.del(`orderbook:${symbol}:asks`);
        await this.redis.del(`orderbook:${symbol}:bids`);

        // Clear order hash maps (order details)
        await this.redis.del(`orderbook:${symbol}:asks:hash`);
        await this.redis.del(`orderbook:${symbol}:bids:hash`);

        this.logger.log(`✅ Cleared order book for ${symbol}`);
      }

      // Clear order queue
      const queueKeys = await this.redis.keys('order:queue:*');
      if (queueKeys.length > 0) {
        await this.redis.del(...queueKeys);
        this.logger.log(`✅ Cleared ${queueKeys.length} order queues`);
      }

      // Clear any other order-related keys
      const orderKeys = await this.redis.keys('order:*');
      if (orderKeys.length > 0) {
        await this.redis.del(...orderKeys);
        this.logger.log(`✅ Cleared ${orderKeys.length} order keys`);
      }

      // Clear any remaining orderbook keys (catch-all)
      const orderbookKeys = await this.redis.keys('orderbook:*');
      if (orderbookKeys.length > 0) {
        await this.redis.del(...orderbookKeys);
        this.logger.log(`✅ Cleared ${orderbookKeys.length} orderbook keys`);
      }

      // Verify all keys are cleared
      const allKeysAfter = await this.redis.keys('*');
      if (allKeysAfter.length > 0) {
        this.logger.warn(`⚠️ Warning: ${allKeysAfter.length} keys still remain in Redis`);
        this.logger.warn(`Remaining keys: ${allKeysAfter.join(', ')}`);
      } else {
        this.logger.log('✅ All Redis keys cleared successfully');
      }
    } catch (error) {
      this.logger.error('❌ Failed to clear Redis:', error);
      throw error;
    }
  }

  private async resetWallets(queryRunner: QueryRunner): Promise<void> {
    // Get all SPOT wallets
    const wallets = await this.walletRepository.find({
      relations: ['user'],
      where: { walletType: WalletType.SPOT },
    });

    this.logger.log(`🔄 Resetting ${wallets.length} wallets...`);

    for (const wallet of wallets) {
      // Determine initial balance based on currency
      const isUSDT = wallet.currency === 'USDT';
      const initialBalance = isUSDT ? 100000 : 100;

      await queryRunner.query(
        `
        UPDATE wallets 
        SET available = $1, frozen = 0, balance = $2
        WHERE id = $3
      `,
        [initialBalance, initialBalance, wallet.id],
      );

      this.logger.log(
        `✅ Reset wallet for user ${wallet.user.id} - ${wallet.currency}: ${initialBalance}`,
      );
    }

    this.logger.log('✅ All wallets reset successfully');
  }
}
