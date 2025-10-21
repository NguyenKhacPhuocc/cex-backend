import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, User, Transaction])],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
