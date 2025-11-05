import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

interface PubSubMessage {
  [key: string]: unknown;
}

@Injectable()
export class RedisPubSub {
  private readonly logger = new Logger(RedisPubSub.name);

  constructor(
    @Inject('REDIS_PUB_CLIENT') private readonly pubClient: Redis,
    @Inject('REDIS_SUB_CLIENT') private readonly subClient: Redis,
  ) {
    this.subClient.on('error', (err) => this.logger.error(`Sub Client Error: ${err}`));
    this.subClient.on('ready', () => this.logger.debug('Redis Pub/Sub Subscriber ready'));
  }

  async publish(channel: string, message: PubSubMessage): Promise<number> {
    try {
      const payload = JSON.stringify(message);
      const listeners = await this.pubClient.publish(channel, payload);
      return listeners;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error publishing to channel ${channel}: ${errorMsg}`);
      throw error;
    }
  }

  async subscribe(channel: string): Promise<void> {
    try {
      await this.subClient.subscribe(channel);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error subscribing to channel ${channel}: ${errorMsg}`);
      throw error;
    }
  }

  onMessage(callback: (channel: string, message: PubSubMessage) => void): void {
    this.subClient.on('message', (channel: string, message: string) => {
      try {
        const parsedMessage = JSON.parse(message) as PubSubMessage;
        callback(channel, parsedMessage);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Error parsing JSON message on channel ${channel}: ${errorMsg} (raw: ${message})`,
        );
      }
    });
  }
}
