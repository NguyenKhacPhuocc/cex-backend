import { BaseStrategy, Action, TickerData } from './base-strategy';
import { OrderSide } from 'src/shared/enums';

export class TrendFollowerStrategy extends BaseStrategy {
  private readonly windowSize = 20; // Number of prices to consider for EMA
  private ema: number = 0;
  private trend: 'up' | 'down' | 'neutral' = 'neutral';
  private lastOrderTime: number = 0;

  constructor(symbol: string) {
    super(symbol);
  }

  onPriceUpdate(ticker: TickerData): void {
    if (ticker.symbol === this.symbol) {
      this.lastPrice = ticker.price;
      this.addToHistory(ticker.price);
      this.updateEMA();
    }
  }

  private updateEMA(): void {
    if (this.priceHistory.length < 2) return;

    const currentPrice = this.priceHistory[this.priceHistory.length - 1];
    const smoothingFactor = 2 / (this.windowSize + 1);

    if (this.ema === 0) {
      // Initialize with SMA
      const sum = this.priceHistory.reduce((acc, p) => acc + p, 0);
      this.ema = sum / this.priceHistory.length;
    } else {
      this.ema = currentPrice * smoothingFactor + this.ema * (1 - smoothingFactor);
    }

    // Determine trend
    if (currentPrice > this.ema * 1.001) {
      this.trend = 'up';
    } else if (currentPrice < this.ema * 0.999) {
      this.trend = 'down';
    } else {
      this.trend = 'neutral';
    }
  }

  getAction(): Action | null {
    if (this.lastPrice === 0 || this.priceHistory.length < this.windowSize) return null;

    const now = Date.now();
    const interval = this.getInterval() * 1000;

    if (now - this.lastOrderTime < interval) {
      return null;
    }

    // Buy in uptrend, sell in downtrend
    let side: OrderSide;
    if (this.trend === 'up') {
      side = OrderSide.BUY;
    } else if (this.trend === 'down') {
      side = OrderSide.SELL;
    } else {
      return null; // No action in neutral trend
    }

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
    // Trend followers trade randomly between 45-180 seconds to simulate real user behavior
    return Math.floor(Math.random() * 135) + 45;
  }
}
