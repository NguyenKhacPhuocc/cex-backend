/* eslint-disable @typescript-eslint/no-floating-promises */
// src/core/redis/redis.service.ts

import { Inject, Injectable } from '@nestjs/common';
import * as IORedis from 'ioredis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS_CLIENT') private readonly client: IORedis.Redis) {}

  // --- STRING (key-value)
  async set(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<string | null> {
    return ttlSeconds
      ? this.client.set(key, value, 'EX', ttlSeconds)
      : this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(...keys: string[]): Promise<number> {
    return this.client.del(...keys);
  }

  async increment(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  // --- LIST (Order Queue)
  async lpush(key: string, ...values: string[]): Promise<number> {
    return this.client.lpush(key, ...values);
  }

  async brpop(key: string, timeout = 0): Promise<[string, string] | null> {
    return this.client.brpop(key, timeout);
  }

  // --- ZSET (Order Book)
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores = false,
  ): Promise<string[]> {
    return withScores
      ? this.client.zrange(key, start, stop, 'WITHSCORES')
      : this.client.zrange(key, start, stop);
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.client.zrem(key, member);
  }

  // --- HASH (Market Cache)
  async hset(key: string, field: string, value: string): Promise<number> {
    return this.client.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  // --- Pub/Sub (đã có file riêng, nhưng bạn vẫn có thể dùng tạm ở đây)
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  subscribe(channel: string, listener: (message: string) => void): void {
    const sub = this.client.duplicate();
    sub.subscribe(channel);
    sub.on('message', (_, message) => listener(message));
  }
}
