/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisPubSub {
  private readonly logger = new Logger(RedisPubSub.name);

  constructor(
    @Inject('REDIS_PUB_CLIENT') private readonly pubClient: Redis,
    @Inject('REDIS_SUB_CLIENT') private readonly subClient: Redis,
  ) {
    this.subClient.on('error', (err) => this.logger.error(`Sub Client Error: ${err}`));
    this.subClient.on('ready', () => console.log('Redis Pub/Sub Subscriber is ready.'));
  }

  async publish(channel: string, message: any): Promise<number> {
    try {
      const payload = JSON.stringify(message);
      const listeners = await this.pubClient.publish(channel, payload);
      return listeners;
    } catch (error) {
      this.logger.error(`Error publishing to channel ${channel}: ${error.message}`);
      throw error; // Nên throw để các service gọi publish có thể xử lý lỗi
    }
  }

  async subscribe(channel: string): Promise<void> {
    try {
      await this.subClient.subscribe(channel);
    } catch (error) {
      this.logger.error(`Error subscribing to channel ${channel}: ${error.message}`);
      throw error;
    }
  }

  onMessage(callback: (channel: string, message: any) => void) {
    this.subClient.on('message', (channel, message) => {
      try {
        const parsedMessage = JSON.parse(message);
        callback(channel, parsedMessage);
      } catch (error) {
        this.logger.error(
          `[RedisPubSub] Error parsing JSON message on channel ${channel}: ${message}`,
          error.stack,
        );
      }
    });
  }
}
