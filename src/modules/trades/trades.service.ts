import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from './entities/trade.entity';
import { User } from '../users/entities/user.entity';
import { TradeHistoryDto } from './dtos/trade-history.dto';
import { PaginationDto, PaginatedResponse } from 'src/common/dtos/pagination.dto';

@Injectable()
export class TradesService {
  constructor(
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
  ) {}

  async getUserTrades(
    user: User,
    pagination: PaginationDto = { page: 1, limit: 20 },
  ): Promise<PaginatedResponse<TradeHistoryDto>> {
    const { page = 1, limit = 20 } = pagination;
    const skip = (page - 1) * limit;

    // Get total count
    const total = await this.tradeRepository.count({
      where: [{ buyer: { id: user.id } }, { seller: { id: user.id } }],
    });

    // Get paginated trades
    const trades = await this.tradeRepository.find({
      where: [{ buyer: { id: user.id } }, { seller: { id: user.id } }],
      order: { timestamp: 'DESC' },
      relations: ['market', 'buyer', 'seller'],
      skip,
      take: limit,
    });

    const data = trades.map((trade) => {
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

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserTradeBySymbol(user: User, symbol: string): Promise<TradeHistoryDto[]> {
    const trades = await this.tradeRepository.find({
      where: [
        { buyer: { id: user.id }, market: { symbol: symbol.toUpperCase() } },
        { seller: { id: user.id }, market: { symbol: symbol.toUpperCase() } },
      ],
      take: 20,
      relations: ['market', 'buyer', 'seller'],
      order: { timestamp: 'DESC' },
    });

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
      id: string;
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

    const result = trades.map((trade) => {
      const side = trade.takerSide || 'BUY';
      return {
        id: trade.id,
        price: Number(trade.price),
        amount: Number(trade.amount),
        total: (Number(trade.price) * Number(trade.amount)).toFixed(8),
        side,
        timestamp: trade.timestamp
          ? new Date(trade.timestamp).toISOString()
          : new Date().toISOString(),
      } as unknown as TradeHistoryDto;
    });

    return result;
  }
}
