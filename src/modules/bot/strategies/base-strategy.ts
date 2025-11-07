import { OrderSide } from 'src/shared/enums';

export interface TickerData {
  symbol: string;
  price: number;
  timestamp: number;
}

export interface Action {
  side: OrderSide;
  price: number;
  amount: number;
}

export interface MarketInfo {
  minOrderSize: number;
  baseAsset: string;
  quoteAsset: string;
  pricePrecision: number; // Số chữ số thập phân cho giá
}

export abstract class BaseStrategy {
  protected symbol: string;
  protected lastPrice: number = 0;
  protected priceHistory: number[] = [];
  protected readonly maxHistorySize = 100;
  protected marketInfo: MarketInfo | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  setMarketInfo(marketInfo: MarketInfo): void {
    this.marketInfo = marketInfo;
  }

  abstract onPriceUpdate(ticker: TickerData): void;
  abstract getAction(): Action | null;
  abstract getInterval(): number;

  protected addToHistory(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > this.maxHistorySize) {
      this.priceHistory.shift();
    }
  }

  protected getRandomAmount(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  protected getRandomPrice(basePrice: number, spreadPercent: number): number {
    const spread = basePrice * spreadPercent;
    const randomOffset = (Math.random() - 0.5) * 2 * spread;
    return basePrice + randomOffset;
  }

  protected roundPrice(price: number, decimals: number = 4): number {
    const factor = Math.pow(10, decimals);
    return Math.round(price * factor) / factor;
  }

  protected roundAmount(amount: number, decimals: number = 5): number {
    const factor = Math.pow(10, decimals);
    return Math.round(amount * factor) / factor;
  }
}
