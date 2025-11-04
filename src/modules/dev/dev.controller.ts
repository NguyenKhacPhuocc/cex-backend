import { Controller, Delete, UseGuards } from '@nestjs/common';
import { DevService } from './dev.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('dev')
export class DevController {
  constructor(private readonly devService: DevService) {}

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
