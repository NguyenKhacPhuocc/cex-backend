import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

export class RandomTraderStrategy extends BaseStrategy {
  private lastOrderTime: number = 0;

  constructor(symbol: string) {
    super(symbol);
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

    if (now - this.lastOrderTime < interval) {
      return null;
    }

    // Random side
    const side = Math.random() > 0.5 ? OrderSide.BUY : OrderSide.SELL;

    // Apply spread random 0.1-0.3% like real users
    const spreadPercent = Math.random() * 0.002 + 0.001; // 0.1-0.3%
    let price: number;
    if (side === OrderSide.BUY) {
      price = this.lastPrice * (1 - spreadPercent);
    } else {
      price = this.lastPrice * (1 + spreadPercent);
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
    // Random traders trade randomly between 30-240 seconds to simulate real user behavior
    return Math.floor(Math.random() * 210) + 30;
  }
}
