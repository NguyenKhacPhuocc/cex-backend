import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UserService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  createUser(userData: Partial<User>) {
    const user = this.repo.create(userData);
    return this.repo.save(user);
  }

  findById(id: number) {
    return this.repo.findOne({ where: { id } });
  }
}
