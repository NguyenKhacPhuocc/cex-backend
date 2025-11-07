import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

/**
 * Market Order Bot Strategy
 * 30% of bots use this strategy
 * Sends market orders to match limit orders and create price volatility
 */
export class MarketOrderBotStrategy extends BaseStrategy {
  private lastOrderTime: number = 0;
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

    const now = Date.now();
    const interval = this.getInterval(); // 500-2000ms

    // Prevent too frequent orders
    if (now - this.lastOrderTime < interval) {
      return null;
    }

    // Random side - market orders can be either buy or sell
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;

    // For market orders, price is not used (will be matched at best available price)
    // But we still need to provide a price for the Action interface
    // The matching engine will ignore this price for MARKET orders
    const price = this.averagePrice;

    // Dynamic amount based on market minOrderSize
    let minAmount = 0.001;
    let maxAmount = 0.01;

    if (this.marketInfo) {
      // Use 10x to 100x minOrderSize for reasonable order sizes
      minAmount = Number(this.marketInfo.minOrderSize) * 10;
      maxAmount = Number(this.marketInfo.minOrderSize) * 100;

      // Ensure minimum viable order size
      if (minAmount < 0.001) minAmount = 0.001;
      if (maxAmount < 0.01) maxAmount = 0.01;
    }

    const amount = this.getRandomAmount(minAmount, maxAmount);

    this.lastOrderTime = now;

    return {
      side,
      price: this.roundPrice(price), // Not used for market orders, but required by interface
      amount: this.roundAmount(amount),
    };
  }

  getInterval(): number {
    // Random interval between 60-180 seconds (60000-180000ms) - much slower for market orders to reduce matching frequency
    return Math.floor(Math.random() * 120000) + 60000;
  }
}
