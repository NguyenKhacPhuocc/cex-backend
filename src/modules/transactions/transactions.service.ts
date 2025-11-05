import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
  ) {}

  // lấy tất cả giao dịch của người dùng
  async getAllTransactions(userId: string): Promise<Transaction[]> {
    return this.transactionRepo.find({
      where: {
        user: { id: userId },
      },
    });
  }

  async getTransactionById(id: string, userId: string): Promise<Transaction | null> {
    return this.transactionRepo.findOne({
      where: {
        id,
        user: { id: userId },
      },
    });
  }
}
