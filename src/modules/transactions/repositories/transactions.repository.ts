import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { Transaction } from '../entities/transaction.entity';

@Injectable()
export class TransactionRepository extends Repository<Transaction> {
  constructor(dataSource: DataSource) {
    super(Transaction, dataSource.createEntityManager());
  }
}
