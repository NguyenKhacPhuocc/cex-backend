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
        price: trade.price,
        amount: trade.amount,
        total: total.toFixed(8), // Using 8 decimal places for precision
        fee: trade.fee,
        timestamp: trade.timestamp,
        counterparty: {
          id: isBuyer ? String(trade.seller.id) : String(trade.buyer.id),
          type: isBuyer ? 'SELLER' : 'BUYER',
        },
      };
      return dto;
    });
  }

  async getUserTradeBySymbol(
    user: User,
    symbol: string,
  ): Promise<TradeHistoryDto[]> {
    const trades = await this.tradeRepository.find({
      where: [
        { buyer: { id: user.id }, market: { symbol: symbol.toUpperCase() } },
        { seller: { id: user.id }, market: { symbol: symbol.toUpperCase() } },
      ],
      relations: ['market', 'buyer', 'seller'],
      order: { timestamp: 'DESC' },
    });

    return trades.map((trade) => {
      const isBuyer = trade.buyer.id === user.id;
      const total = Number(trade.price) * Number(trade.amount);

      const dto: TradeHistoryDto = {
        id: trade.id,
        market: trade.market.symbol,
        side: isBuyer ? 'BUY' : 'SELL',
        price: trade.price,
        amount: trade.amount,
        total: total.toFixed(8),
        fee: trade.fee,
        timestamp: trade.timestamp,
        counterparty: {
          id: isBuyer ? String(trade.seller.id) : String(trade.buyer.id),
          type: isBuyer ? 'SELLER' : 'BUYER',
        },
      };
      return dto;
    });
  }
}
