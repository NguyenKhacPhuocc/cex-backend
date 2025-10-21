// src/modules/wallets/wallets.controller.ts
import { Controller, UseGuards, Get, Param } from '@nestjs/common';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // Lấy tất cả giao dịch của user
  @Get()
  async getAllTransactions(@GetUser() user: User) {
    return this.transactionsService.getAllTransactions(user.id);
  }

  // lấy chi tiết 1 giao dịch theo id
  @Get(':id')
  async getTransactionById(@Param('id') id: string, @GetUser() user: User) {
    return this.transactionsService.getTransactionById(id, user.id);
  }
}
