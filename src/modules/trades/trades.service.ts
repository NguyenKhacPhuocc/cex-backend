import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from './entities/trade.entity';
import { User } from '../users/entities/user.entity';

import { TradeHistoryDto } from './dtos/trade-history.dto';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
  ) {}

  async getUserTrades(user: User): Promise<TradeHistoryDto[]> {
    const trades = await this.tradeRepository.find({
      where: [{ buyer: { id: user.id } }, { seller: { id: user.id } }],
      order: { timestamp: 'DESC' },
      relations: ['market', 'buyer', 'seller'],
    });

    return trades.map((trade) => {
      const isBuyer = trade.buyer.id === user.id;
      const total = Number(trade.price) * Number(trade.amount);

      const dto: TradeHistoryDto = {
        id: trade.id,
        market: trade.market.symbol,
        side: isBuyer ? 'BUY' : 'SELL',
        price: Number(trade.price), // Convert decimal string to number
        amount: Number(trade.amount), // Convert decimal string to number
        total: total.toFixed(8), // Using 8 decimal places for precision
        fee: Number(trade.fee), // Convert decimal string to number
        timestamp: trade.timestamp
          ? new Date(trade.timestamp).toISOString()
          : new Date().toISOString(),
        counterparty: {
          id: isBuyer ? String(trade.seller.id) : String(trade.buyer.id),
          type: isBuyer ? 'SELLER' : 'BUYER',
        },
      };
      return dto;
    });
  }

  async getUserTradeBySymbol(user: User, symbol: string): Promise<TradeHistoryDto[]> {
    const trades = await this.tradeRepository.find({
      where: [
        { buyer: { id: user.id }, market: { symbol: symbol.toUpperCase() } },
        { seller: { id: user.id }, market: { symbol: symbol.toUpperCase() } },
      ],
      relations: ['market', 'buyer', 'seller'],
      order: { timestamp: 'DESC' },
    });

    console.log(
      `📊 [getUserTradeBySymbol] User ${user.id} trades for ${symbol}:`,
      JSON.stringify(trades, null, 2),
    );

    const result = trades.map((trade) => {
      const isBuyer = trade.buyer.id === user.id;
      const total = Number(trade.price) * Number(trade.amount);

      const dto: TradeHistoryDto = {
        id: trade.id,
        market: trade.market.symbol,
        side: isBuyer ? 'BUY' : 'SELL',
        price: Number(trade.price), // Convert decimal string to number
        amount: Number(trade.amount), // Convert decimal string to number
        total: total.toFixed(8),
        fee: Number(trade.fee), // Convert decimal string to number
        timestamp: trade.timestamp
          ? new Date(trade.timestamp).toISOString()
          : new Date().toISOString(),
        counterparty: {
          id: isBuyer ? String(trade.seller.id) : String(trade.buyer.id),
          type: isBuyer ? 'SELLER' : 'BUYER',
        },
      };
      return dto;
    });

    console.log(
      `📤 [getUserTradeBySymbol] Formatted result for user ${user.id}:`,
      JSON.stringify(result, null, 2),
    );

    return result;
  }

  /**
   * Get recent market trades for a symbol (PUBLIC - no auth required)
   * Returns last 50 trades
   */
  async getMarketTrades(
    symbol: string,
    limit = 50,
  ): Promise<
    {
      id: number;
      price: number;
      amount: number;
      total: string;
      side: 'BUY' | 'SELL';
      timestamp: string; // ISO 8601 string format
    }[]
  > {
    const trades = await this.tradeRepository.find({
      where: { market: { symbol: symbol.toUpperCase() } },
      relations: ['market', 'buyer'],
      order: { timestamp: 'DESC' },
      take: limit,
    });

    console.log('📊 [getMarketTrades] Raw trades from DB:', JSON.stringify(trades, null, 2));
    console.log('📊 [getMarketTrades] First trade timestamp:', trades[0]?.timestamp);

    const result = trades.map((trade) => {
      console.log(`🕐 Trade ${trade.id} timestamp:`, trade.timestamp, typeof trade.timestamp);
      // Use takerSide if available, otherwise default to BUY
      // takerSide determines color: BUY = green (price went up), SELL = red (price went down)
      const side = trade.takerSide || 'BUY';
      return {
        id: trade.id,
        price: Number(trade.price), // Convert decimal string to number
        amount: Number(trade.amount), // Convert decimal string to number
        total: (Number(trade.price) * Number(trade.amount)).toFixed(8),
        side, // Use takerSide from database
        timestamp: trade.timestamp
          ? new Date(trade.timestamp).toISOString()
          : new Date().toISOString(),
      };
    });

    console.log('📤 [getMarketTrades] Formatted result:', JSON.stringify(result, null, 2));

    return result;
  }
}
