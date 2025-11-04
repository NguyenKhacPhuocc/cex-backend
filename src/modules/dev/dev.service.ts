import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import Redis from 'ioredis';
import { Trade } from '../trades/entities/trade.entity';
import { Order } from '../order/entities/order.entity';
import { Wallet, WalletType } from '../wallets/entities/wallet.entity';
import { Market, MarketStatus } from '../market/entities/market.entity';
import { Candle } from '../candles/entities/candle.entity';
import { User } from '../users/entities/user.entity';

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
    @InjectRepository(Candle)
    private readonly candleRepository: Repository<Candle>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
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

      // Step 2: Delete candles (has FK to markets)
      this.logger.log('🗑️ Deleting candles...');
      await queryRunner.query('DELETE FROM candles');

      // Step 3: Delete trades (has FK to orders)
      this.logger.log('🗑️ Deleting trades...');
      await queryRunner.query('DELETE FROM trades');

      // Step 4: Delete orders
      this.logger.log('🗑️ Deleting orders...');
      await queryRunner.query('DELETE FROM orders');

      // Step 5: Delete ledger_entries
      this.logger.log('🗑️ Deleting ledger entries...');
      await queryRunner.query('DELETE FROM ledger_entries');

      // Step 6: Delete transactions
      this.logger.log('🗑️ Deleting transactions...');
      await queryRunner.query('DELETE FROM transactions');

      // Step 7: Reset wallets to initial values
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
  async seedMarkets(): Promise<{
    message: string;
    created: number;
    markets: Array<{ symbol: string; baseAsset: string; quoteAsset: string }>;
  }> {
    this.logger.log('🌱 Starting to seed markets...');

    const defaultMarkets = [
      { baseAsset: 'BTC', quoteAsset: 'USDT' },
      { baseAsset: 'ETH', quoteAsset: 'USDT' },
      { baseAsset: 'SOL', quoteAsset: 'USDT' },
      { baseAsset: 'BNB', quoteAsset: 'USDT' },
      { baseAsset: 'DOGE', quoteAsset: 'USDT' },
      { baseAsset: 'XRP', quoteAsset: 'USDT' },
      { baseAsset: 'ADA', quoteAsset: 'USDT' },
      { baseAsset: 'AVAX', quoteAsset: 'USDT' },
      { baseAsset: 'MATIC', quoteAsset: 'USDT' },
      { baseAsset: 'LTC', quoteAsset: 'USDT' },
      { baseAsset: 'LINK', quoteAsset: 'USDT' },
      { baseAsset: 'DOT', quoteAsset: 'USDT' },
      { baseAsset: 'TAO', quoteAsset: 'USDT' },
      { baseAsset: 'TON', quoteAsset: 'USDT' },
      { baseAsset: 'PEPE', quoteAsset: 'USDT' },
    ];

    const createdMarkets: Array<{ symbol: string; baseAsset: string; quoteAsset: string }> = [];

    for (const market of defaultMarkets) {
      const symbol = `${market.baseAsset}_${market.quoteAsset}`;
      const existing = await this.marketRepository.findOne({
        where: { symbol },
      });

      if (!existing) {
        const newMarket = this.marketRepository.create({
          symbol,
          baseAsset: market.baseAsset,
          quoteAsset: market.quoteAsset,
          status: MarketStatus.ACTIVE,
          minOrderSize: 0.0001,
          pricePrecision: 2,
        });
        const saved = await this.marketRepository.save(newMarket);
        this.logger.log(`✅ Created market: ${symbol}`);
        createdMarkets.push({
          symbol: saved.symbol,
          baseAsset: saved.baseAsset,
          quoteAsset: saved.quoteAsset,
        });
      } else {
        // Market already exists - ensure it's active
        if (existing.status !== MarketStatus.ACTIVE) {
          existing.status = MarketStatus.ACTIVE;
          await this.marketRepository.save(existing);
          this.logger.log(`🔄 Activated market: ${symbol}`);
        } else {
          this.logger.log(`⏭️ Market already exists: ${symbol}`);
        }
      }
    }

    const message =
      createdMarkets.length > 0
        ? `✅ Successfully seeded ${createdMarkets.length} new markets`
        : '✅ All markets already exist and are active';

    this.logger.log(message);

    return {
      message,
      created: createdMarkets.length,
      markets: createdMarkets,
    };
  }

  async getBotStatus(): Promise<{
    message: string;
    botCount: number;
    markets: Array<{ symbol: string; status: string }>;
    botUsers: Array<{ email: string; id: string }>;
  }> {
    this.logger.log('🔍 Checking bot status...');

    // Get all bot users
    const botUsers = await this.userRepository.find({
      where: {},
    });

    const botEmails = botUsers
      .filter((u) => u.email?.toLowerCase().includes('bot'))
      .map((u) => ({ email: u.email, id: String(u.id) }));

    this.logger.log(`Found ${botEmails.length} bot users`);

    // Get all markets
    const markets = await this.marketRepository.find();
    const marketStatus = markets.map((m) => ({
      symbol: m.symbol,
      status: m.status as string,
    }));

    this.logger.log(`Found ${markets.length} markets`);
    this.logger.log(`Markets: ${JSON.stringify(marketStatus)}`);

    return {
      message: `Bot status report: ${botEmails.length} bots, ${markets.length} markets`,
      botCount: botEmails.length,
      markets: marketStatus,
      botUsers: botEmails,
    };
  }

  private async clearRedis(): Promise<void> {
    try {
      // Log all keys before clearing
      const allKeysBefore = await this.redis.keys('*');
      this.logger.log(`📦 Found ${allKeysBefore.length} keys in Redis before clearing`);
      if (allKeysBefore.length > 0) {
        this.logger.log(`Keys: ${allKeysBefore.join(', ')}`);
      }

      // Delete ALL keys in Redis (FLUSHDB equivalent)
      if (allKeysBefore.length > 0) {
        await this.redis.del(...allKeysBefore);
        this.logger.log(`✅ Deleted ${allKeysBefore.length} keys from Redis`);
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
      // Check if this is a bot user (email starts with "bot")
      const user = wallet.user as { email?: string } | undefined;
      const userEmail = user?.email || '';
      const isBot = typeof userEmail === 'string' && userEmail.toLowerCase().startsWith('bot');

      // Determine initial balance based on currency and user type
      let initialBalance: number;
      if (isBot) {
        // Bot wallets: BTC = 100, USDT = 1000000 (from BOT_INITIAL_BALANCE config)
        const isUSDT = wallet.currency === 'USDT';
        initialBalance = isUSDT ? 1000000 : 100;
      } else {
        // Regular user wallets: USDT = 100000, BTC = 100
        const isUSDT = wallet.currency === 'USDT';
        initialBalance = isUSDT ? 1000000 : 100;
      }

      await queryRunner.query(
        `
        UPDATE wallets 
        SET available = $1, frozen = 0, balance = $2
        WHERE id = $3
      `,
        [initialBalance, initialBalance, wallet.id],
      );

      this.logger.log(
        `✅ Reset wallet for ${isBot ? 'bot' : 'user'} ${wallet.user.id} - ${wallet.currency}: ${initialBalance}`,
      );
    }

    this.logger.log('✅ All wallets reset successfully');
  }
}
