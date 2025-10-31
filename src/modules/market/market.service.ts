import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Market, MarketStatus } from './entities/market.entity';
import { CreateMarketDto } from './dtos/create-market.dto';
import { Trade } from '../trades/entities/trade.entity';
import { TickerDto } from './dtos/ticker.dto';

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(Market)
    private marketRepository: Repository<Market>,
    @InjectRepository(Trade)
    private tradeRepository: Repository<Trade>,
  ) {}

  async findAll(): Promise<Market[]> {
    return this.marketRepository.find();
  }

  async findBySymbol(symbol: string): Promise<Market | null> {
    return this.marketRepository.findOne({
      where: { symbol },
    });
  }
  async create(createMarketDto: CreateMarketDto): Promise<Market> {
    const { baseAsset, quoteAsset } = createMarketDto;

    const upperBaseAsset = baseAsset.toUpperCase();
    const upperQuoteAsset = quoteAsset.toUpperCase();
    const symbol = `${upperBaseAsset}_${upperQuoteAsset}`;

    const existingMarket = await this.marketRepository.findOne({
      where: { symbol },
    });

    if (existingMarket) {
      throw new BadRequestException(`Market with symbol ${symbol} already exists.`);
    }

    const newMarketData = {
      ...createMarketDto,
      baseAsset: upperBaseAsset,
      quoteAsset: upperQuoteAsset,
      symbol,
    };

    const newMarket = this.marketRepository.create(newMarketData);
    return this.marketRepository.save(newMarket);
  }

  /**
   * Get ticker data for all markets
   * Calculates: lastPrice, change24h, volume24h from trades
   */
  async getAllTickers(): Promise<TickerDto[]> {
    const markets = await this.marketRepository.find({
      where: { status: MarketStatus.ACTIVE },
    });

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const tickers: TickerDto[] = await Promise.all(
      markets.map(async (market) => {
        // Get all trades for this market in the last 24 hours
        const trades24h = await this.tradeRepository.find({
          where: {
            market: { id: market.id },
            timestamp: MoreThan(twentyFourHoursAgo),
          },
          order: { timestamp: 'ASC' },
        });

        // Get the most recent trade (last price)
        const lastTrade = await this.tradeRepository.findOne({
          where: { market: { id: market.id } },
          order: { timestamp: 'DESC' },
        });

        const lastPrice = lastTrade ? Number(lastTrade.price) : 0;

        // Calculate price 24h ago (first trade in 24h window)
        const price24hAgo = trades24h.length > 0 ? Number(trades24h[0].price) : lastPrice;

        // Calculate change 24h
        let change24h = 0;
        if (price24hAgo > 0) {
          change24h = ((lastPrice - price24hAgo) / price24hAgo) * 100;
        }

        // Calculate volume 24h (sum of amount * price for all trades in 24h)
        const volume24h = trades24h.reduce((sum, trade) => {
          return sum + Number(trade.amount) * Number(trade.price);
        }, 0);

        // Calculate high/low 24h
        let high24h = lastPrice;
        let low24h = lastPrice;
        if (trades24h.length > 0) {
          const prices = trades24h.map((t) => Number(t.price));
          high24h = Math.max(...prices);
          low24h = Math.min(...prices);
        }

        // Format symbol for frontend: BTC_USDT -> BTC/USDT
        const pair = `${market.baseAsset}/${market.quoteAsset}`;

        return {
          symbol: market.symbol,
          pair,
          price: lastPrice,
          change24h: Number(change24h.toFixed(2)),
          volume24h: Number(volume24h.toFixed(8)),
          high24h: Number(high24h.toFixed(8)),
          low24h: Number(low24h.toFixed(8)),
        };
      }),
    );

    return tickers;
  }

  /**
   * Get ticker data for a specific symbol (more efficient than getAllTickers)
   * Used for real-time updates after trades
   */
  async getTickerBySymbol(symbol: string): Promise<TickerDto | null> {
    const market = await this.marketRepository.findOne({
      where: { symbol: symbol.toUpperCase(), status: MarketStatus.ACTIVE },
    });

    if (!market) {
      return null;
    }

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Get all trades for this market in the last 24 hours
    const trades24h = await this.tradeRepository.find({
      where: {
        market: { id: market.id },
        timestamp: MoreThan(twentyFourHoursAgo),
      },
      order: { timestamp: 'ASC' },
    });

    // Get the most recent trade (last price)
    const lastTrade = await this.tradeRepository.findOne({
      where: { market: { id: market.id } },
      order: { timestamp: 'DESC' },
    });

    const lastPrice = lastTrade ? Number(lastTrade.price) : 0;

    // Calculate price 24h ago (first trade in 24h window)
    const price24hAgo = trades24h.length > 0 ? Number(trades24h[0].price) : lastPrice;

    // Calculate change 24h
    let change24h = 0;
    if (price24hAgo > 0) {
      change24h = ((lastPrice - price24hAgo) / price24hAgo) * 100;
    }

    // Calculate volume 24h (sum of amount * price for all trades in 24h)
    const volume24h = trades24h.reduce((sum, trade) => {
      return sum + Number(trade.amount) * Number(trade.price);
    }, 0);

    // Calculate high/low 24h
    let high24h = lastPrice;
    let low24h = lastPrice;
    if (trades24h.length > 0) {
      const prices = trades24h.map((t) => Number(t.price));
      high24h = Math.max(...prices);
      low24h = Math.min(...prices);
    }

    // Format symbol for frontend: BTC_USDT -> BTC/USDT
    const pair = `${market.baseAsset}/${market.quoteAsset}`;

    return {
      symbol: market.symbol,
      pair,
      price: lastPrice,
      change24h: Number(change24h.toFixed(2)),
      volume24h: Number(volume24h.toFixed(8)),
      high24h: Number(high24h.toFixed(8)),
      low24h: Number(low24h.toFixed(8)),
    };
  }
}
