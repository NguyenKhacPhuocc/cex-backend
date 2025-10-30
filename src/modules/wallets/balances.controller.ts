import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { WalletsService } from './wallets.service';
import { WalletType } from './entities/wallet.entity';

interface BalanceItem {
  asset: string;
  available: string;
  locked: string;
}

@Controller('balances')
@UseGuards(JwtAuthGuard)
export class BalancesController {
  constructor(private readonly walletsService: WalletsService) {}

  /**
   * GET /api/balances/spot
   * Lấy balance từ Spot Wallets của user từ DATABASE
   */
  @Get('spot')
  async getSpotBalance(@GetUser() user: User): Promise<BalanceItem[]> {
    const wallets = await this.walletsService.getWalletsByType(user.id, WalletType.SPOT);

    // Format data
    return wallets.map((wallet) => ({
      asset: wallet.currency,
      available: wallet.available.toString(),
      locked: wallet.frozen.toString(),
      type: wallet.walletType as string,
    }));
  }

  /**
   * GET /api/balances/futures
   * Lấy balance từ Futures Wallets của user từ DATABASE
   */
  @Get('futures')
  async getFuturesBalance(@GetUser() user: User): Promise<BalanceItem[]> {
    const wallets = await this.walletsService.getWalletsByType(user.id, WalletType.FUTURES);

    return wallets.map((wallet) => ({
      asset: wallet.currency,
      available: wallet.available.toString(),
      locked: wallet.frozen.toString(),
      type: wallet.walletType as string,
    }));
  }

  /**
   * GET /api/balances/funding
   * Lấy balance từ Funding Wallets của user từ DATABASE
   */
  @Get('funding')
  async getFundingBalance(@GetUser() user: User): Promise<BalanceItem[]> {
    const wallets = await this.walletsService.getWalletsByType(user.id, WalletType.FUNDING);

    return wallets.map((wallet) => ({
      asset: wallet.currency,
      available: wallet.available.toString(),
      locked: wallet.frozen.toString(),
      type: wallet.walletType as string,
    }));
  }

  /**
   * GET /api/balances
   * Lấy TẤT CẢ balances (Spot + Futures + Funding) và merge
   */
  @Get()
  async getAllBalances(@GetUser() user: User): Promise<BalanceItem[]> {
    // Lấy tất cả wallets của user
    const [spotBalances, futuresBalances, fundingBalances] = await Promise.all([
      this.getSpotBalance(user),
      this.getFuturesBalance(user),
      this.getFundingBalance(user),
    ]);

    // Merge balances by asset
    const balanceMap = new Map<string, BalanceItem>();

    const addBalance = (balance: BalanceItem) => {
      const existing = balanceMap.get(balance.asset);
      if (existing) {
        // Merge: Cộng dồn available và locked
        balanceMap.set(balance.asset, {
          asset: balance.asset,
          available: (parseFloat(existing.available) + parseFloat(balance.available)).toString(),
          locked: (parseFloat(existing.locked) + parseFloat(balance.locked)).toString(),
        });
      } else {
        balanceMap.set(balance.asset, balance);
      }
    };

    // Merge all balances
    spotBalances.forEach(addBalance);
    futuresBalances.forEach(addBalance);
    fundingBalances.forEach(addBalance);

    return Array.from(balanceMap.values());
  }
}
