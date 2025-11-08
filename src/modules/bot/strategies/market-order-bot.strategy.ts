import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

/**
 * Market Order Bot Strategy
 * 30% of bots use this strategy
 * Sends market orders to match limit orders and create price volatility
 */
export class MarketOrderBotStrategy extends BaseStrategy {
  private averagePrice: number = 0;

  constructor(symbol: string) {
    super(symbol);
  }

  onPriceUpdate(ticker: TickerData): void {
    if (ticker.symbol === this.symbol) {
      this.lastPrice = ticker.price;
      this.addToHistory(ticker.price);
    }
  }

  /**
   * Set the average price from Binance reference
   */
  setAveragePrice(price: number): void {
    this.averagePrice = price;
    this.lastPrice = price;
  }

  getAction(): Action | null {
    if (this.averagePrice === 0) return null;

    // Random side - market orders can be either buy or sell
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;

    // For market orders, price is not used (will be matched at best available price)
    // But we still need to provide a price for the Action interface
    const price = this.averagePrice;

    // Dynamic amount based on market minOrderSize
    let minAmount = 0.001;
    let maxAmount = 0.05;

    if (this.marketInfo) {
      // Use 10x to 100x minOrderSize for reasonable order sizes
      minAmount = Number(this.marketInfo.minOrderSize) * 20;
      maxAmount = Number(this.marketInfo.minOrderSize) * 200;

      // Ensure minimum viable order size
      if (minAmount < 0.001) minAmount = 0.001;
      if (maxAmount < 0.01) maxAmount = 0.01;
    }

    const amount = this.getRandomAmount(minAmount, maxAmount);

    return {
      side,
      price: this.roundPrice(price),
      amount: this.roundAmount(amount),
    };
  }

  getInterval(): number {
    // Random interval between 60-180 seconds (60000-180000ms) - much slower for market orders to reduce matching frequency
    return Math.floor(Math.random() * 120000) + 60000; // 60000
  }
}
