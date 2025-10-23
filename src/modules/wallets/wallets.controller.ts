/* eslint-disable @typescript-eslint/no-unused-vars */
// src/modules/wallets/wallets.controller.ts
import { Controller, Post, Body, UseGuards, Get, Query } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { User, UserRole } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletTransactionDto } from './dtos/wallet-transaction.dto';
import { TransferDto } from './dtos/transfer.dto';
import { HistoryQueryDto } from './dtos/history-query.dto';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';

@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  // nạp tiền vào ví
  @Post('deposit')
  @Roles(UserRole.USER)
  async depositToUser(
    @GetUser() user: User,
    @Body() walletTransactionDto: WalletTransactionDto,
  ) {
    const wallet = await this.walletsService.depositToUser(
      user.id,
      walletTransactionDto,
    );
    const { user: unusedUser, ...walletDetails } = wallet;
    return {
      message: `Deposited ${walletTransactionDto.amount} ${walletTransactionDto.currency} to ${walletTransactionDto.walletType} wallet`,
      wallet: {
        ...walletDetails,
        userId: user.id,
      },
    };
  }

  // rút tiền từ ví
  @Post('withdraw')
  @Roles(UserRole.USER)
  async withdrawFromUser(
    @GetUser() user: User,
    @Body() walletTransactionDto: WalletTransactionDto,
  ) {
    const wallet = await this.walletsService.withdrawFromUser(
      user.id,
      walletTransactionDto,
    );

    const { user: unusedUser, ...walletDetails } = wallet;
    return {
      message: `Withdrew ${walletTransactionDto.amount} ${walletTransactionDto.currency} from ${walletTransactionDto.walletType} wallet`,
      wallet: {
        ...walletDetails,
        userId: user.id,
      },
    };
  }

  // chuyển tiền giữa các ví nội bộ cập nhật balance/available
  @Post('transfer')
  @Roles(UserRole.USER)
  async transferBetweenWallets(
    @GetUser() user: User,
    @Body() transferDto: TransferDto,
  ) {
    await this.walletsService.transferBetweenWallets(user.id, transferDto);
    return {
      message: `Transferred ${transferDto.amount} ${transferDto.currency} from ${transferDto.fromWalletType} to ${transferDto.toWalletType} wallet`,
      code: 'success',
    };
  }

  // theo dõi biến động tài sản (chỉ admin được sử dụng)
  @Get('history')
  @Roles(UserRole.ADMIN)
  async getHistory(
    @GetUser() user: User,
    @Query() historyQueryDto: HistoryQueryDto,
  ) {
    return this.walletsService.getWalletHistory(user.id, historyQueryDto);
  }
}
