// src/core/redis/redis-config.factory.ts (Đã cập nhật)

import { Injectable } from '@nestjs/common';
import { env } from 'process';
import * as IORedis from 'ioredis';
import * as redisStore from 'cache-manager-ioredis';
import { CacheOptionsFactory, CacheModuleOptions } from '@nestjs/cache-manager';

@Injectable()
export class RedisConfigFactory implements CacheOptionsFactory {
  // 1. Dùng cho RedisModule (trả về tùy chọn ioredis thuần)
  createRedisOptions(): IORedis.RedisOptions {
    return {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT ? parseInt(env.REDIS_PORT, 10) : 6379,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DATABASE ? parseInt(env.REDIS_DATABASE, 10) : 0,
    };
  }

  // 2. Dùng cho CacheModule (trả về tùy chọn CacheModule có store)
  createCacheOptions(): CacheModuleOptions {
    return {
      store: redisStore,
      ...this.createRedisOptions(), // Tái sử dụng tùy chọn cơ bản
    };
  }
}
