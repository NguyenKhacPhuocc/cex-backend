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
import { Candle } from '../../modules/candles/entities/candle.entity';

// Helper function to get WebSocket CORS origins (same logic as main.ts)
function getWebSocketCorsOrigins(): string[] {
  const origins: string[] = [];

  // Add localhost for development
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000');
  }

  // Parse FRONTEND_URL - support multiple URLs separated by comma
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    const urls = frontendUrl.split(',').map((url) => url.trim());

    for (const url of urls) {
      if (!url) continue;

      // Add https:// if missing protocol
      let normalizedUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        normalizedUrl = `https://${url}`;
      }

      origins.push(normalizedUrl);
    }
  }

  // If no origins specified, allow localhost
  if (origins.length === 0) {
    origins.push('http://localhost:3000');
  }

  return origins;
}

@WebSocketGateway({
  cors: {
    origin: getWebSocketCorsOrigins(),
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
  private candleSubscriptions: Map<string, Set<string>> = new Map(); // `${symbol}:${timeframe}` -> Set of socketIds

  constructor(
    private jwtService: JwtService,
    @Inject(forwardRef(() => OrderBookService))
    private orderBookService: OrderBookService,
    @Inject(forwardRef(() => MarketService))
    private marketService: MarketService,
  ) {}

  afterInit() {}

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

      // Allow anonymous connections for public market data (ticker, orderbook)
      if (!token) {
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

        // Send confirmation with userId
        client.emit('connected', { userId, socketId: client.id });
      } catch {
        // Token invalid - allow as anonymous
        this.logger.warn(`Invalid token for client ${client.id}, allowing anonymous connection`);
        client.data.userId = null;
        client.data.isAuthenticated = false;
        client.emit('connected', { socketId: client.id });
      }
    } catch (error) {
      // Allow connection even on error (public data)
      this.logger.warn(
        `Connection error for client ${client.id}, allowing anonymous:`,
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
  }

  // Emit order update to specific user
  emitOrderUpdate(userId: string, orderId: string, status: string) {
    // Convert status to UPPERCASE for frontend consistency
    const statusUpperCase = status.toUpperCase();

    this.server.to(`user:${userId}`).emit('order:updated', {
      userId,
      orderId,
      status: statusUpperCase,
      timestamp: Date.now(),
    });
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

    // Notify buyer (always BUY side)
    this.server.to(`user:${buyerId}`).emit('trade:executed', {
      tradeId,
      userId: buyerId,
      side: 'BUY',
      symbol,
      price,
      amount,
      timestamp: Date.now(),
    });

    // Notify seller (always SELL side)
    this.server.to(`user:${sellerId}`).emit('trade:executed', {
      tradeId,
      userId: sellerId,
      side: 'SELL',
      symbol,
      price,
      amount,
      timestamp: Date.now(),
    });

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

  // Broadcast market trade to all connected clients (public)
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
    // Broadcast to all connected clients (public market data)
    const broadcastData = {
      symbol,
      ...trade,
      total: (trade.price * trade.amount).toFixed(8),
    };
    this.server.emit('trade:new', broadcastData);
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

    // Send initial snapshot
    try {
      const snapshot = await this.orderBookService.getOrderBookSnapshot(symbol, 20);
      client.emit('orderbook:snapshot', snapshot);
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

    // Send initial snapshot
    try {
      const ticker = await this.marketService.getTickerBySymbol(symbol);

      if (ticker) {
        client.emit('ticker:snapshot', ticker);
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
  }

  // ========== Candle Subscription Handlers ==========

  @SubscribeMessage('candle:subscribe')
  handleCandleSubscribe(client: Socket, payload: { symbol: string; timeframe: string }): void {
    const { symbol, timeframe } = payload;

    if (!symbol || !timeframe) {
      this.logger.warn(`Client ${client.id} tried to subscribe without symbol or timeframe`);
      return;
    }

    const key = `${symbol}:${timeframe}`;
    if (!this.candleSubscriptions.has(key)) {
      this.candleSubscriptions.set(key, new Set());
    }

    this.candleSubscriptions.get(key)?.add(client.id);
  }

  @SubscribeMessage('candle:unsubscribe')
  handleCandleUnsubscribe(client: Socket, payload: { symbol: string; timeframe: string }): void {
    const { symbol, timeframe } = payload;

    if (!symbol || !timeframe) {
      return;
    }

    const key = `${symbol}:${timeframe}`;
    this.candleSubscriptions.get(key)?.delete(client.id);

    if (this.candleSubscriptions.get(key)?.size === 0) {
      this.candleSubscriptions.delete(key);
    }
  }

  // Broadcast candle update to all subscribers
  broadcastCandleUpdate(symbol: string, timeframe: string, candle: Candle): void {
    const key = `${symbol}:${timeframe}`;
    const subscribers = this.candleSubscriptions.get(key);

    if (!subscribers || subscribers.size === 0) {
      return;
    }

    // Convert candle to format expected by lightweight-charts (Unix timestamp in seconds)
    const candleData = {
      time: Math.floor(candle.timestamp.getTime() / 1000),
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    };

    subscribers.forEach((socketId) => {
      this.server.to(socketId).emit('candle:update', candleData);
    });
  }
}
