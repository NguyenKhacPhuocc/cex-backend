import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

export class MarketMakerStrategy extends BaseStrategy {
  private readonly spreadPercent: number;
  private lastOrderTime: number = 0;

  constructor(symbol: string, spreadPercent: number = 0.0005) {
    super(symbol);
    // Reduced spread to follow Binance prices more closely
    this.spreadPercent = spreadPercent;
  }

  onPriceUpdate(ticker: TickerData): void {
    if (ticker.symbol === this.symbol) {
      this.lastPrice = ticker.price;
      this.addToHistory(ticker.price);
    }
  }

  getAction(): Action | null {
    if (this.lastPrice === 0) return null;

    const now = Date.now();
    const interval = this.getInterval() * 1000;

    // Prevent too frequent orders
    if (now - this.lastOrderTime < interval) {
      return null;
    }

    const basePrice = this.lastPrice;

    // Random side like real users
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;

    // Apply spread to create price differences that increase match probability
    let price: number;
    if (side === OrderSide.BUY) {
      // Buy below market price (bid)
      price = basePrice * (1 - this.spreadPercent);
    } else {
      // Sell above market price (ask)
      price = basePrice * (1 + this.spreadPercent);
    }

    // Dynamic amount based on market minOrderSize
    let minAmount = 0.001;
    let maxAmount = 0.01;

    // Use market-specific amounts if available
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
      price: this.roundPrice(price),
      amount: this.roundAmount(amount),
    };
  }

  getInterval(): number {
    // Market makers trade randomly between 30-120 seconds to simulate real user behavior
    return Math.floor(Math.random() * 90) + 30;
  }
}
