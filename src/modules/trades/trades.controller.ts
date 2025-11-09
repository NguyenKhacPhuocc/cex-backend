import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { TradesService } from './trades.service';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { User, UserRole } from '../users/entities/user.entity';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TradeHistoryDto } from './dtos/trade-history.dto';
import { PaginationDto, PaginatedResponse } from 'src/common/dtos/pagination.dto';

@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  // PUBLIC: Get recent market trades for a symbol (no auth required)
  @Get('market/:symbol')
  async getMarketTrades(@Param('symbol') symbol: string) {
    return this.tradesService.getMarketTrades(symbol, 50);
  }

  // PRIVATE: Lịch sử khớp lệnh cá nhân
  @Get('history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async getUserTrades(
    @GetUser() user: User,
    @Query() pagination: PaginationDto,
  ): Promise<PaginatedResponse<TradeHistoryDto>> {
    return this.tradesService.getUserTrades(user, pagination);
  }

  // PRIVATE: Lịch sử khớp lệnh cá nhân theo cặp thị trường
  @Get('history/:symbol')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async getUserTradeBySymbol(
    @GetUser() user: User,
    @Param('symbol') symbol: string,
  ): Promise<TradeHistoryDto[]> {
    return this.tradesService.getUserTradeBySymbol(user, symbol);
  }
}
