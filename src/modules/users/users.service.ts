import { Injectable, OnModuleInit } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User, UserRole } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService implements OnModuleInit {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async onModuleInit() {
    try {
      const adminEmail = 'admin@gmail.com';
      const adminExists = await this.findByEmail(adminEmail);
      if (!adminExists) {
        const hashedPassword = await bcrypt.hash('123123', 10);
        const adminUser = this.repo.create({
          email: adminEmail,
          passwordHash: hashedPassword,
          role: UserRole.ADMIN,
        });
        await this.repo.save(adminUser);
        console.log('Default admin user created: admin@gmail.com');
      }
    } catch (error) {
      // If tables don't exist yet, log error but don't crash app
      // Tables will be created by synchronize or migrations
      console.error('Error initializing admin user (tables may not exist yet):', error.message);
    }
  }

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
