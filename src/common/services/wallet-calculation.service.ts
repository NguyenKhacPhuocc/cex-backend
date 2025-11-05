import { Injectable } from '@nestjs/common';
import { Wallet } from 'src/modules/wallets/entities/wallet.entity';

/**
 * Service for wallet balance calculations and validations
 * Centralizes all wallet balance update logic to prevent duplication and bugs
 */
@Injectable()
export class WalletCalculationService {
  /**
   * Lock balance (move from available to frozen)
   * Used when: Creating LIMIT order, placing BUY order
   */
  lockBalance(wallet: Wallet, amount: number): void {
    wallet.available = Math.max(0, Number(wallet.available) - Number(amount));
    wallet.frozen = Number(wallet.frozen) + Number(amount);
  }

  /**
   * Unlock balance (move from frozen to available)
   * Used when: Canceling order, order not filled
   */
  unlockBalance(wallet: Wallet, amount: number): void {
    wallet.frozen = Math.max(0, Number(wallet.frozen) - Number(amount));
    wallet.available = Number(wallet.available) + Number(amount);
  }

  /**
   * Transfer between available and frozen
   * Used when: Order partially filled, settlement
   */
  transferFrozenToAvailable(wallet: Wallet, amount: number): void {
    wallet.frozen = Math.max(0, Number(wallet.frozen) - Number(amount));
    wallet.available = Number(wallet.available) + Number(amount);
  }

  /**
   * Transfer from available to frozen (reverse of transferFrozenToAvailable)
   * Used when: Adding more funds to frozen balance
   */
  transferAvailableToFrozen(wallet: Wallet, amount: number): void {
    wallet.available = Math.max(0, Number(wallet.available) - Number(amount));
    wallet.frozen = Number(wallet.frozen) + Number(amount);
  }

  /**
   * Recalculate total balance
   * balance = available + frozen
   */
  recalculateBalance(wallet: Wallet): void {
    wallet.balance = Number(wallet.available) + Number(wallet.frozen);
  }

  /**
   * Recalculate multiple wallets
   */
  recalculateBalances(...wallets: Wallet[]): void {
    wallets.forEach((w) => this.recalculateBalance(w));
  }

  /**
   * Validate wallet safety (no negative values)
   */
  isValidWallet(wallet: Wallet): boolean {
    return (
      Number(wallet.available) >= 0 && Number(wallet.frozen) >= 0 && Number(wallet.balance) >= 0
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
    wallet.available = Number(wallet.available) + Number(amount);
    this.recalculateBalance(wallet);
  }

  /**
   * Subtract amount from available balance
   * Used when: Withdrawal, transfer sent
   */
  subtractFromAvailable(wallet: Wallet, amount: number): void {
    wallet.available = Math.max(0, Number(wallet.available) - Number(amount));
    this.recalculateBalance(wallet);
  }

  /**
   * Add amount to frozen balance
   * Used when: Additional order locking
   */
  addToFrozen(wallet: Wallet, amount: number): void {
    wallet.frozen = Number(wallet.frozen) + Number(amount);
    this.recalculateBalance(wallet);
  }

  /**
   * Subtract amount from frozen balance
   * Used when: Order cancellation, partial fill
   */
  subtractFromFrozen(wallet: Wallet, amount: number): void {
    wallet.frozen = Math.max(0, Number(wallet.frozen) - Number(amount));
    this.recalculateBalance(wallet);
  }
}
