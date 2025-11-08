import { Injectable, Logger } from '@nestjs/common';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';

/**
 * Service for wallet balance calculations and validations
 * Centralizes all wallet balance update logic to prevent duplication and bugs
 */
@Injectable()
export class WalletCalculationService {
  private readonly logger = new Logger(WalletCalculationService.name);

  /**
   * Normalize wallet values to ensure no NaN, null, or undefined
   * Converts null/undefined to 0, and ensures values are valid numbers
   */
  private normalizeWalletValue(value: number | null | undefined): number {
    if (value === null || value === undefined || isNaN(Number(value))) {
      return 0;
    }
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Normalize amount to ensure it's a valid positive number
   */
  private normalizeAmount(amount: number | null | undefined): number {
    if (amount === null || amount === undefined || isNaN(Number(amount))) {
      return 0;
    }
    const num = Number(amount);
    return isNaN(num) || num < 0 ? 0 : num;
  }

  /**
   * Ensure wallet has valid values before operations
   */
  private ensureValidWallet(wallet: Wallet): void {
    wallet.available = this.normalizeWalletValue(wallet.available);
    wallet.frozen = this.normalizeWalletValue(wallet.frozen);
    wallet.balance = this.normalizeWalletValue(wallet.balance);
  }

  /**
   * Lock balance (move from available to frozen)
   * Used when: Creating LIMIT order, placing BUY order
   */
  lockBalance(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`lockBalance: Invalid amount ${amount}, skipping`);
      return;
    }

    wallet.available = Math.max(0, wallet.available - normalizedAmount);
    wallet.frozen = wallet.frozen + normalizedAmount;
    this.recalculateBalance(wallet);
  }

  /**
   * Unlock balance (move from frozen to available)
   * Used when: Canceling order, order not filled
   */
  unlockBalance(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`unlockBalance: Invalid amount ${amount}, skipping`);
      return;
    }

    // Ensure we don't unlock more than what's frozen
    const actualUnlock = Math.min(normalizedAmount, wallet.frozen);
    wallet.frozen = Math.max(0, wallet.frozen - actualUnlock);
    wallet.available = wallet.available + actualUnlock;
    this.recalculateBalance(wallet);
  }

  /**
   * Transfer between available and frozen
   * Used when: Order partially filled, settlement
   */
  transferFrozenToAvailable(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`transferFrozenToAvailable: Invalid amount ${amount}, skipping`);
      return;
    }

    const actualTransfer = Math.min(normalizedAmount, wallet.frozen);
    wallet.frozen = Math.max(0, wallet.frozen - actualTransfer);
    wallet.available = wallet.available + actualTransfer;
    this.recalculateBalance(wallet);
  }

  /**
   * Transfer from available to frozen (reverse of transferFrozenToAvailable)
   * Used when: Adding more funds to frozen balance
   */
  transferAvailableToFrozen(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`transferAvailableToFrozen: Invalid amount ${amount}, skipping`);
      return;
    }

    const actualTransfer = Math.min(normalizedAmount, wallet.available);
    wallet.available = Math.max(0, wallet.available - actualTransfer);
    wallet.frozen = wallet.frozen + actualTransfer;
    this.recalculateBalance(wallet);
  }

  /**
   * Recalculate total balance
   * balance = available + frozen
   */
  recalculateBalance(wallet: Wallet): void {
    wallet.available = this.normalizeWalletValue(wallet.available);
    wallet.frozen = this.normalizeWalletValue(wallet.frozen);
    wallet.balance = wallet.available + wallet.frozen;

    // Final safety check - ensure no NaN
    if (isNaN(wallet.balance) || isNaN(wallet.available) || isNaN(wallet.frozen)) {
      this.logger.error(`Wallet ${wallet.id} has NaN values after recalculation. Resetting to 0.`, {
        available: wallet.available,
        frozen: wallet.frozen,
        balance: wallet.balance,
      });
      wallet.available = 0;
      wallet.frozen = 0;
      wallet.balance = 0;
    }
  }

  /**
   * Recalculate multiple wallets
   */
  recalculateBalances(...wallets: Wallet[]): void {
    wallets.forEach((w) => this.recalculateBalance(w));
  }

  /**
   * Validate wallet safety (no negative values, no NaN)
   */
  isValidWallet(wallet: Wallet): boolean {
    const available = this.normalizeWalletValue(wallet.available);
    const frozen = this.normalizeWalletValue(wallet.frozen);
    const balance = this.normalizeWalletValue(wallet.balance);

    return (
      available >= 0 &&
      frozen >= 0 &&
      balance >= 0 &&
      !isNaN(available) &&
      !isNaN(frozen) &&
      !isNaN(balance)
    );
  }

  /**
   * Validate multiple wallets
   */
  areValidWallets(...wallets: Wallet[]): boolean {
    return wallets.every((w) => this.isValidWallet(w));
  }

  /**
   * Add amount to available balance
   * Used when: Deposit, withdrawal reversal, transfer received
   */
  addToAvailable(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`addToAvailable: Invalid amount ${amount}, skipping`);
      return;
    }

    wallet.available = wallet.available + normalizedAmount;
    this.recalculateBalance(wallet);
  }

  /**
   * Subtract amount from available balance
   * Used when: Withdrawal, transfer sent
   */
  subtractFromAvailable(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`subtractFromAvailable: Invalid amount ${amount}, skipping`);
      return;
    }

    wallet.available = Math.max(0, wallet.available - normalizedAmount);
    this.recalculateBalance(wallet);
  }

  /**
   * Add amount to frozen balance
   * Used when: Additional order locking
   */
  addToFrozen(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`addToFrozen: Invalid amount ${amount}, skipping`);
      return;
    }

    wallet.frozen = wallet.frozen + normalizedAmount;
    this.recalculateBalance(wallet);
  }

  /**
   * Subtract amount from frozen balance
   * Used when: Order cancellation, partial fill
   */
  subtractFromFrozen(wallet: Wallet, amount: number): void {
    this.ensureValidWallet(wallet);
    const normalizedAmount = this.normalizeAmount(amount);

    if (normalizedAmount <= 0) {
      this.logger.warn(`subtractFromFrozen: Invalid amount ${amount}, skipping`);
      return;
    }

    // Ensure we don't subtract more than what's frozen
    const actualSubtract = Math.min(normalizedAmount, wallet.frozen);
    wallet.frozen = Math.max(0, wallet.frozen - actualSubtract);
    this.recalculateBalance(wallet);
  }
}
