import { Controller, Delete, Post, Get, UseGuards } from '@nestjs/common';
import { DevService } from './dev.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('dev')
export class DevController {
  constructor(private readonly devService: DevService) {}

  /**
   * Debug endpoint - Check bot and market status
   * WARNING: Only admins can use this endpoint
   */
  @Get('bot-status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getBotStatus(): Promise<{
    message: string;
    botCount: number;
    markets: Array<{ symbol: string; status: string }>;
    botUsers: Array<{ email: string; id: string }>;
  }> {
    return await this.devService.getBotStatus();
  }

  /**
   * Seed default markets (BTC, ETH, SOL, etc. pairs with USDT)
   * WARNING: Will create markets if they don't exist
   * Only admins can use this endpoint
   */
  @Post('seed-markets')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async seedMarkets(): Promise<{
    message: string;
    created: number;
    markets: Array<{ symbol: string; baseAsset: string; quoteAsset: string }>;
  }> {
    return await this.devService.seedMarkets();
  }

  /**
   * Reset database and clear Redis
   * WARNING: This will delete all trading data and reset wallets!
   * Only admins can use this endpoint
   */
  @Delete('reset-database')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async resetDatabase(): Promise<{
    message: string;
    details: {
      redis: string;
      trades: string;
      orders: string;
      ledger_entries: string;
      transactions: string;
      wallets: string;
    };
  }> {
    await this.devService.resetDatabase();
    return {
      message: 'Database reset successfully',
      details: {
        redis: 'Cleared',
        trades: 'Deleted',
        orders: 'Deleted',
        ledger_entries: 'Deleted',
        transactions: 'Deleted',
        wallets: 'Reset to initial values (USDT: 100000, BTC: 100)',
      },
    };
  }
}
