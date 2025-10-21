import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisService } from './redis.service';
import { RedisPubSub } from './redis.pubsub';
import { RedisConfigFactory } from './redis-config.factory';

const redisClientProvider: Provider<Redis> = {
  provide: 'REDIS_CLIENT',
  useFactory: (configFactory: RedisConfigFactory): Redis => {
    const redisOptions = configFactory.createRedisOptions();
    return new Redis(redisOptions);
  },
  inject: [RedisConfigFactory],
};

const redisPubClientProvider: Provider<Redis> = {
  provide: 'REDIS_PUB_CLIENT',
  useFactory: (configFactory: RedisConfigFactory): Redis => {
    const redisOptions = configFactory.createRedisOptions();
    return new Redis(redisOptions);
  },
  inject: [RedisConfigFactory],
};

const redisSubClientProvider: Provider<Redis> = {
  provide: 'REDIS_SUB_CLIENT',
  useFactory: (configFactory: RedisConfigFactory): Redis => {
    const redisOptions = configFactory.createRedisOptions();
    return new Redis(redisOptions);
  },
  inject: [RedisConfigFactory],
};

@Global()
@Module({
  providers: [
    RedisService,
    RedisPubSub,
    RedisConfigFactory,
    redisClientProvider,
    redisPubClientProvider,
    redisSubClientProvider,
  ],
  exports: [
    RedisService,
    RedisPubSub,
    redisClientProvider,
    redisPubClientProvider,
    redisSubClientProvider,
  ],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redisClient: Redis,
    @Inject('REDIS_PUB_CLIENT') private readonly redisPubClient: Redis,
    @Inject('REDIS_SUB_CLIENT') private readonly redisSubClient: Redis,
  ) {
    console.log('RedisModule initialized with 3 clients.');
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Redis clients...');
    await Promise.all([
      this.redisClient.quit(),
      this.redisPubClient.quit(),
      this.redisSubClient.quit(),
    ]);
    this.logger.log('All Redis clients disconnected successfully.');
  }
}
