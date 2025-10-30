import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository, Between } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { User } from '../users/entities/user.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { WalletTransactionDto } from './dtos/wallet-transaction.dto';
import { LedgerEntry, LedgerReferenceType } from '../ledger/entities/ledger.entity';
import { TransferDto } from './dtos/transfer.dto';
import { HistoryQueryDto } from './dtos/history-query.dto';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Transaction)
    private transactionRepo: Repository<Transaction>,
    @InjectRepository(LedgerEntry)
    private ledgerRepo: Repository<LedgerEntry>,
  ) {}

  async depositToUser(userId: number, walletTransactionDto: WalletTransactionDto): Promise<Wallet> {
    const { walletType, currency, amount } = walletTransactionDto;
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    let wallet = await this.walletRepo.findOne({
      where: {
        user: { id: userId },
        walletType: walletType,
        currency: currency.toUpperCase(),
      },
      relations: ['user'],
    });

    const balanceBefore = wallet ? wallet.balance : 0;

    if (!wallet) {
      wallet = this.walletRepo.create({
        user,
        walletType,
        currency: currency.toUpperCase(),
        balance: amount,
        available: amount,
      });
      await this.walletRepo.save(wallet);
    } else {
      // cộng thêm tiền nếu ví đã tồn tại
      wallet.balance = Number(wallet.balance) + Number(amount);
      wallet.available = Number(wallet.available) + Number(amount);
      await this.walletRepo.save(wallet);
    }

    // tạm tạo fake txHash cho dễ theo dõi
    const txHash = `demo_deposit_txHash_${Date.now()}`;
    // thêm bản ghi vào bảng transactions
    const transaction = this.transactionRepo.create({
      user,
      wallet,
      type: TransactionType.DEPOSIT,
      amount,
      currency: currency.toUpperCase(),
      status: TransactionStatus.COMPLETED,
      txHash,
    });
    await this.transactionRepo.save(transaction);

    // thêm bản ghi vào bảng ledger_entries (sổ cái)
    const ledgerEntry = this.ledgerRepo.create({
      user,
      wallet,
      currency: currency.toUpperCase(),
      changeAmount: amount,
      balanceBefore,
      balanceAfter: wallet.balance,
      referenceType: LedgerReferenceType.DEPOSIT,
      referenceId: transaction.id,
      description: `Deposit of ${amount} ${currency}`,
    });
    await this.ledgerRepo.save(ledgerEntry);

    return wallet;
  }

  async withdrawFromUser(userId: number, walletTransactionDto: WalletTransactionDto) {
    const { walletType, currency, amount } = walletTransactionDto;
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // tìm ví
    const wallet = await this.walletRepo.findOne({
      where: { user: { id: userId }, walletType, currency },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet not found (${walletType} - ${currency})`);
    }
    // kiểm tra số dư
    if (wallet.balance < amount) {
      throw new BadRequestException('Insufficient balance');
    }
    const balanceBefore = wallet.balance;

    // 3. Cập nhật số dư
    wallet.available -= amount;
    wallet.balance -= amount;
    await this.walletRepo.save(wallet);

    // 4. Ghi lịch sử rút tiền (optional, nên có)                                                                                              │
    // Tạm tạo fake txHash cho dễ theo dõi
    const txHash = `demo_withdraw_txHash_${Date.now()}`;
    const transaction = this.transactionRepo.create({
      user,
      wallet,
      type: TransactionType.WITHDRAW,
      amount,
      currency,
      status: TransactionStatus.COMPLETED,
      txHash,
    });
    await this.transactionRepo.save(transaction);

    const ledgerEntry = this.ledgerRepo.create({
      user,
      wallet,
      currency,
      changeAmount: -amount,
      balanceBefore,
      balanceAfter: wallet.balance,
      referenceType: LedgerReferenceType.WITHDRAW,
      referenceId: transaction.id,
      description: `Withdrawal of ${amount} ${currency}`,
    });
    await this.ledgerRepo.save(ledgerEntry);

    return wallet;
  }

  async transferBetweenWallets(userId: number, transferDto: TransferDto): Promise<void> {
    const { fromWalletType, toWalletType, currency, amount } = transferDto;

    if (fromWalletType === toWalletType) {
      throw new BadRequestException('Cannot transfer to the same wallet type');
    }

    await this.walletRepo.manager.transaction(async (transactionalEntityManager) => {
      const user = await transactionalEntityManager.findOne(User, {
        where: { id: userId },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const fromWallet = await transactionalEntityManager.findOne(Wallet, {
        where: { user: { id: userId }, walletType: fromWalletType, currency },
      });

      const toWallet = await transactionalEntityManager.findOne(Wallet, {
        where: { user: { id: userId }, walletType: toWalletType, currency },
      });

      if (!fromWallet) {
        throw new NotFoundException(`Wallet not found (${fromWalletType} - ${currency})`);
      }

      if (fromWallet.available < amount) {
        throw new BadRequestException('Insufficient available balance');
      }

      let toWalletInstance = toWallet;
      if (!toWalletInstance) {
        toWalletInstance = transactionalEntityManager.create(Wallet, {
          user,
          walletType: toWalletType,
          currency,
          balance: 0,
          available: 0,
        });
      }

      const fromBalanceBefore = fromWallet.balance;
      const toBalanceBefore = toWalletInstance.balance;

      fromWallet.balance = Number(fromWallet.balance) - Number(amount);
      fromWallet.available = Number(fromWallet.available) - Number(amount);

      toWalletInstance.balance = Number(toWalletInstance.balance) + Number(amount);
      toWalletInstance.available = Number(toWalletInstance.available) + Number(amount);

      await transactionalEntityManager.save(fromWallet);
      await transactionalEntityManager.save(toWalletInstance);

      const transaction = transactionalEntityManager.create(Transaction, {
        user,
        wallet: fromWallet, // Associate transaction with the source wallet
        toWallet: toWalletInstance, // Associate transaction with the destination wallet
        type: TransactionType.TRANSFER,
        amount,
        currency,
        status: TransactionStatus.COMPLETED,
        txHash: `demo_transfer_txHash_${Date.now()}`, // Fake txHash
      });
      await transactionalEntityManager.save(transaction);

      const fromLedgerEntry = transactionalEntityManager.create(LedgerEntry, {
        user,
        wallet: fromWallet,
        currency,
        changeAmount: -amount,
        balanceBefore: fromBalanceBefore,
        balanceAfter: fromWallet.balance,
        referenceType: LedgerReferenceType.TRANSFER,
        referenceId: transaction.id,
        description: `Transfer of ${amount} ${currency} from ${fromWalletType} to ${toWalletType}`,
      });

      const toLedgerEntry = transactionalEntityManager.create(LedgerEntry, {
        user,
        wallet: toWalletInstance,
        currency,
        changeAmount: amount,
        balanceBefore: toBalanceBefore,
        balanceAfter: toWalletInstance.balance,
        referenceType: LedgerReferenceType.TRANSFER,
        referenceId: transaction.id,
        description: `Transfer of ${amount} ${currency} from ${fromWalletType} to ${toWalletType}`,
      });

      await transactionalEntityManager.save([fromLedgerEntry, toLedgerEntry]);
    });
  }

  async getWalletHistory(userId: number, query: HistoryQueryDto) {
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const where: FindOptionsWhere<LedgerEntry> = { user: { id: userId } };
    if (query.currency) {
      where.currency = query.currency;
    }
    if (query.walletType) {
      where.wallet = { walletType: query.walletType };
    }
    if (query.startDate && query.endDate) {
      where.createdAt = Between(new Date(query.startDate), new Date(query.endDate));
    } else if (query.startDate) {
      where.createdAt = Between(new Date(query.startDate), new Date());
    }

    const [data, total] = await this.ledgerRepo.findAndCount({
      where,
      relations: ['wallet'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Lấy tất cả wallets của user theo walletType
   */
  async getWalletsByType(userId: number, walletType: string): Promise<Wallet[]> {
    return this.walletRepo.find({
      where: {
        user: { id: userId },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        walletType: walletType as any,
      },
    });
  }
}
