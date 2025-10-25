import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TradesService } from './trades.service';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TradeHistoryDto } from './dtos/trade-history.dto';

@Controller('trades')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  // Lịch sử khớp lệnh cá nhân, Truy vấn trades theo user_id, dùng cho tab “Lịch sử giao dịch”.
  @Get('history')
  @Roles(UserRole.USER)
  async getUserTrades(@GetUser() user: User): Promise<TradeHistoryDto[]> {
    return this.tradesService.getUserTrades(user);
  }

  // Lịch sử khớp lệnh cá nhân theo cặp thị trường, Truy vấn trades theo user_id và symbol, dùng cho tab “Lịch sử giao dịch”.
  @Get('history/:symbol')
  @Roles(UserRole.USER)
  async getUserTradeBySymbol(
    @GetUser() user: User,
    @Param('symbol') symbol: string,
  ): Promise<TradeHistoryDto[]> {
    return this.tradesService.getUserTradeBySymbol(user, symbol);
  }
}
