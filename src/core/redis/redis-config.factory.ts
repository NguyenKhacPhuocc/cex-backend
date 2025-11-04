// src/core/redis/redis-config.factory.ts (Đã cập nhật)

import { Injectable } from '@nestjs/common';
import { env } from 'process';
import * as IORedis from 'ioredis';
import * as redisStore from 'cache-manager-ioredis';
import { CacheOptionsFactory, CacheModuleOptions } from '@nestjs/cache-manager';

@Injectable()
export class RedisConfigFactory implements CacheOptionsFactory {
  /**
   * Parse Redis URL to extract connection options
   * Supports formats:
   * - redis://password@host:port
   * - redis://default:password@host:port
   * - redis://:password@host:port
   * - rediss://... (TLS/SSL connection - Upstash uses this)
   */
  private parseRedisUrl(url: string): IORedis.RedisOptions {
    try {
      const parsedUrl = new URL(url);
      const isTLS = parsedUrl.protocol === 'rediss:'; // rediss:// means TLS

      return {
        host: parsedUrl.hostname,
        port: parsedUrl.port ? parseInt(parsedUrl.port, 10) : 6379,
        password: parsedUrl.password || undefined,
        // Upstash doesn't use database numbers, so default to 0
        db: 0,
        // Enable TLS for rediss:// URLs (Upstash uses TLS)
        tls: isTLS ? {} : undefined,
      };
    } catch {
      throw new Error(`Invalid REDIS_URL format: ${url}`);
    }
  }

  // 1. Dùng cho RedisModule (trả về tùy chọn ioredis thuần)
  createRedisOptions(): IORedis.RedisOptions {
    // Priority: REDIS_URL > individual variables
    if (env.REDIS_URL) {
      return this.parseRedisUrl(env.REDIS_URL);
    }

    // Fallback to individual variables
    return {
      host: env.REDIS_HOST || 'localhost',
      port: env.REDIS_PORT ? parseInt(env.REDIS_PORT, 10) : 6379,
      password: env.REDIS_PASSWORD || undefined,
      db: env.REDIS_DATABASE ? parseInt(env.REDIS_DATABASE, 10) : 0,
    };
  }

  // 2. Dùng cho CacheModule (trả về tùy chọn CacheModule có store)
  createCacheOptions(): CacheModuleOptions {
    const redisOptions = this.createRedisOptions();
    return {
      store: redisStore,
      ...redisOptions,
    };
  }
}
