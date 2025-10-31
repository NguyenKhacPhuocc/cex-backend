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
import { MarketService } from '../../modules/market/market.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || ['http://localhost:3000'],
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
  private tickerSubscriptions: Map<string, Set<string>> = new Map(); // symbol -> Set of socketIds

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => OrderBookService))
    private orderBookService: OrderBookService,
    @Inject(forwardRef(() => MarketService))
    private marketService: MarketService,
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

      // ✅ Allow anonymous connections for public market data (ticker, orderbook)
      if (!token) {
        this.logger.log(`✅ Client ${client.id} connected anonymously (public market data only)`);
        // Mark as anonymous
        client.data.userId = null;
        client.data.isAuthenticated = false;

        // Send confirmation without userId
        client.emit('connected', { socketId: client.id });
        return;
      }

      // Verify JWT token for authenticated users
      try {
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
        client.data.isAuthenticated = true;

        // Join user's personal room
        await client.join(`user:${userId}`);

        this.logger.log(
          `✅ Client ${client.id} connected (User: ${userId}, Total sockets: ${this.userSockets.get(userId)!.size})`,
        );

        // Send confirmation with userId
        client.emit('connected', { userId, socketId: client.id });
      } catch {
        // Token invalid - allow as anonymous
        this.logger.warn(`⚠️ Invalid token for client ${client.id}, allowing anonymous connection`);
        client.data.userId = null;
        client.data.isAuthenticated = false;
        client.emit('connected', { socketId: client.id });
      }
    } catch (error) {
      // Allow connection even on error (public data)
      this.logger.warn(
        `⚠️ Connection error for client ${client.id}, allowing anonymous:`,
        error instanceof Error ? error.message : String(error),
      );
      client.data.userId = null;
      client.data.isAuthenticated = false;
      client.emit('connected', { socketId: client.id });
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
    takerSide: 'BUY' | 'SELL'; // Taker side for market display color
  }) {
    const { tradeId, buyerId, sellerId, symbol, price, amount, takerSide } = tradeData;

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
      side: takerSide, // Use takerSide for color display (BUY = green, SELL = red)
      timestamp: new Date(),
    });

    // Broadcast ticker update for this symbol (public event - no subscription needed)
    this.broadcastTickerUpdate(symbol).catch((error) => {
      this.logger.error(`Error broadcasting ticker update for ${symbol}:`, error);
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

  // Broadcast ticker update to all connected clients (public event)
  async broadcastTickerUpdate(symbol: string): Promise<void> {
    try {
      const ticker = await this.marketService.getTickerBySymbol(symbol);

      if (!ticker) {
        this.logger.warn(`Ticker not found for symbol: ${symbol}`);
        return;
      }

      // Broadcast to all subscribers and all connected clients (public market data)
      this.server.emit('ticker:update', ticker);

      // Also emit to specific subscribers if any
      const subscribers = this.tickerSubscriptions.get(symbol);
      if (subscribers && subscribers.size > 0) {
        subscribers.forEach((socketId) => {
          this.server.to(socketId).emit('ticker:update', ticker);
        });
      }

      this.logger.log(`📈 Broadcasted ticker:update for ${symbol} to all clients`);
    } catch (error) {
      this.logger.error(`Error broadcasting ticker update for ${symbol}:`, error);
    }
  }

  // ========== Ticker Subscription Handlers ==========

  @SubscribeMessage('ticker:subscribe')
  async handleTickerSubscribe(client: Socket, payload: { symbol: string }): Promise<void> {
    const { symbol } = payload;

    if (!symbol) {
      this.logger.warn(`Client ${client.id} tried to subscribe to ticker without symbol`);
      client.emit('ticker:error', { message: 'Symbol is required' });
      return;
    }

    // Add client to symbol subscribers
    if (!this.tickerSubscriptions.has(symbol)) {
      this.tickerSubscriptions.set(symbol, new Set());
    }
    this.tickerSubscriptions.get(symbol)!.add(client.id);

    this.logger.log(`📈 Client ${client.id} subscribed to ticker: ${symbol}`);

    // Send initial snapshot
    try {
      const ticker = await this.marketService.getTickerBySymbol(symbol);

      if (ticker) {
        client.emit('ticker:snapshot', ticker);
        this.logger.log(`📸 Sent ticker snapshot to ${client.id} for ${symbol}`);
      } else {
        client.emit('ticker:error', {
          message: `Ticker not found for symbol: ${symbol}`,
        });
      }
    } catch (error) {
      this.logger.error(`Error fetching ticker snapshot for ${symbol}:`, error);
      client.emit('ticker:error', {
        message: 'Failed to fetch ticker',
      });
    }
  }

  @SubscribeMessage('ticker:unsubscribe')
  handleTickerUnsubscribe(client: Socket, payload: { symbol: string }): void {
    const { symbol } = payload;

    if (!symbol) return;

    const subscribers = this.tickerSubscriptions.get(symbol);
    if (subscribers) {
      subscribers.delete(client.id);

      if (subscribers.size === 0) {
        this.tickerSubscriptions.delete(symbol);
      }
    }

    this.logger.log(`Client ${client.id} unsubscribed from ticker: ${symbol}`);
  }
}
