/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, forwardRef, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OrderBookService } from '../../modules/trading/order-book.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  },
  namespace: '/trading',
})
export class TradingWebSocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TradingWebSocketGateway.name);
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private orderbookSubscriptions: Map<string, Set<string>> = new Map(); // symbol -> Set of socketIds

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => OrderBookService))
    private orderBookService: OrderBookService,
  ) {
    this.logger.log('🚀 TradingWebSocketGateway CONSTRUCTOR called');
  }

  afterInit() {
    this.logger.log('✅ TradingWebSocketGateway initialized successfully!');
    this.logger.log(`📡 Listening on namespace: /trading`);
    this.logger.log(`🌐 Ready to accept WebSocket connections`);
  }

  async handleConnection(client: Socket) {
    try {
      // Extract token from multiple sources
      let token = client.handshake.auth?.token || client.handshake.headers?.authorization;

      // If no token in auth, try to get from cookies (httpOnly support)
      if (!token) {
        const cookies = client.handshake.headers.cookie;
        if (cookies) {
          const cookieArray = cookies.split(';');
          for (const cookie of cookieArray) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'accessToken') {
              token = value;
              break;
            }
          }
        }
      }

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token`);
        client.disconnect();
        return;
      }

      // Verify JWT token

      const payload = await this.jwtService.verifyAsync(
        typeof token === 'string' ? token.replace('Bearer ', '') : token,
      );
      const userId = payload.sub;

      // Store socket mapping
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);

      // Store userId in socket data for later use
      client.data.userId = userId;

      // Join user's personal room
      await client.join(`user:${userId}`);

      this.logger.log(
        `✅ Client ${client.id} connected (User: ${userId}, Total sockets: ${this.userSockets.get(userId)!.size})`,
      );

      // Send confirmation
      client.emit('connected', { userId, socketId: client.id });
    } catch (error) {
      this.logger.error(
        `❌ Authentication failed for client ${client.id}:`,
        error instanceof Error ? error.message : String(error),
      );
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;

    if (userId && this.userSockets.has(userId)) {
      this.userSockets.get(userId)!.delete(client.id);

      if (this.userSockets.get(userId)!.size === 0) {
        this.userSockets.delete(userId);
      }

      this.logger.log(
        `❌ Client ${client.id} disconnected (User: ${userId}, Remaining: ${this.userSockets.get(userId)?.size || 0})`,
      );
    } else {
      this.logger.log(`❌ Client ${client.id} disconnected (No userId)`);
    }
  }

  @SubscribeMessage('ping')
  handlePing(client: Socket) {
    client.emit('pong', { timestamp: Date.now() });
  }

  // Emit balance update to specific user
  emitBalanceUpdate(userId: string) {
    this.server.to(`user:${userId}`).emit('balance:updated', {
      userId,
      timestamp: Date.now(),
    });

    this.logger.log(
      `📡 Emitted balance:updated to user ${userId} (sockets: ${this.userSockets.get(userId)?.size || 0})`,
    );
  }

  // Emit order update to specific user
  emitOrderUpdate(userId: string, orderId: string, status: string) {
    this.server.to(`user:${userId}`).emit('order:updated', {
      userId,
      orderId,
      status,
      timestamp: Date.now(),
    });

    this.logger.log(
      `📡 Emitted order:updated to user ${userId} (order: ${orderId}, status: ${status})`,
    );
  }

  // Emit trade execution to both buyer and seller
  emitTradeExecuted(tradeData: {
    tradeId: string;
    buyerId: string;
    sellerId: string;
    symbol: string;
    price: number;
    amount: number;
  }) {
    const { tradeId, buyerId, sellerId, symbol, price, amount } = tradeData;

    // Notify buyer
    this.server.to(`user:${buyerId}`).emit('trade:executed', {
      tradeId,
      userId: buyerId,
      side: 'buy',
      symbol,
      price,
      amount,
      timestamp: Date.now(),
    });

    // Notify seller
    this.server.to(`user:${sellerId}`).emit('trade:executed', {
      tradeId,
      userId: sellerId,
      side: 'sell',
      symbol,
      price,
      amount,
      timestamp: Date.now(),
    });

    this.logger.log(
      `📡 Emitted trade:executed to buyer ${buyerId} and seller ${sellerId} (trade: ${tradeId})`,
    );

    // Also broadcast to all orderbook subscribers (public market trade)
    this.broadcastMarketTrade(symbol, {
      id: parseInt(tradeId),
      price,
      amount,
      side: 'BUY',
      timestamp: new Date(),
    });
  }

  // Broadcast market trade to all subscribers (public)
  broadcastMarketTrade(
    symbol: string,
    trade: {
      id: number;
      price: number;
      amount: number;
      side: 'BUY' | 'SELL';
      timestamp: Date;
    },
  ) {
    const subscribers = this.orderbookSubscriptions.get(symbol);

    if (!subscribers || subscribers.size === 0) {
      return;
    }

    // Emit to all subscribers
    subscribers.forEach((socketId) => {
      this.server.to(socketId).emit('trade:new', {
        symbol,
        ...trade,
        total: (trade.price * trade.amount).toFixed(8),
      });
    });

    this.logger.log(`💹 Broadcasted market trade for ${symbol} to ${subscribers.size} clients`);
  }

  // Get connected users count
  getConnectedUsersCount(): number {
    return this.userSockets.size;
  }

  // Get user's socket count
  getUserSocketCount(userId: string): number {
    return this.userSockets.get(userId)?.size || 0;
  }

  // ========== OrderBook Subscription Handlers ==========

  @SubscribeMessage('orderbook:subscribe')
  async handleOrderBookSubscribe(client: Socket, payload: { symbol: string }): Promise<void> {
    const { symbol } = payload;

    if (!symbol) {
      this.logger.warn(`Client ${client.id} tried to subscribe without symbol`);
      return;
    }

    // Add client to symbol subscribers
    if (!this.orderbookSubscriptions.has(symbol)) {
      this.orderbookSubscriptions.set(symbol, new Set());
    }
    this.orderbookSubscriptions.get(symbol)!.add(client.id);

    this.logger.log(`📊 Client ${client.id} subscribed to orderbook: ${symbol}`);

    // Send initial snapshot
    try {
      const snapshot = await this.orderBookService.getOrderBookSnapshot(symbol, 20);
      client.emit('orderbook:snapshot', snapshot);
      this.logger.log(`📸 Sent orderbook snapshot to ${client.id} for ${symbol}`);
    } catch (error) {
      this.logger.error(`Error fetching orderbook snapshot for ${symbol}:`, error);
      client.emit('orderbook:error', {
        message: 'Failed to fetch orderbook',
      });
    }
  }

  @SubscribeMessage('orderbook:unsubscribe')
  handleOrderBookUnsubscribe(client: Socket, payload: { symbol: string }): void {
    const { symbol } = payload;

    if (!symbol) return;

    const subscribers = this.orderbookSubscriptions.get(symbol);
    if (subscribers) {
      subscribers.delete(client.id);

      if (subscribers.size === 0) {
        this.orderbookSubscriptions.delete(symbol);
      }
    }

    this.logger.log(`Client ${client.id} unsubscribed from orderbook: ${symbol}`);
  }

  // Broadcast orderbook update to all subscribers of a symbol
  async broadcastOrderBookUpdate(symbol: string): Promise<void> {
    const subscribers = this.orderbookSubscriptions.get(symbol);

    if (!subscribers || subscribers.size === 0) {
      return; // No one is subscribed
    }

    try {
      const snapshot = await this.orderBookService.getOrderBookSnapshot(symbol, 20);

      // Emit to all subscribers
      subscribers.forEach((socketId) => {
        this.server.to(socketId).emit('orderbook:update', snapshot);
      });

      this.logger.log(
        `🔄 Broadcasted orderbook update for ${symbol} to ${subscribers.size} clients`,
      );
    } catch (error) {
      this.logger.error(`Error broadcasting orderbook update for ${symbol}:`, error);
    }
  }
}
