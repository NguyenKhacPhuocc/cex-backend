import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User, UserRole } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService implements OnModuleInit {
  private readonly logger = new Logger(UserService.name);

  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async onModuleInit() {
    // Only seed admin if explicitly enabled via SEED_ADMIN=true env var
    if (process.env.SEED_ADMIN !== 'true') {
      return;
    }

    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
      const adminExists = await this.findByEmail(adminEmail);

      if (!adminExists) {
        const defaultPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
        const hashedPassword = await bcrypt.hash(defaultPassword, 10);
        const adminUser = this.repo.create({
          email: adminEmail,
          passwordHash: hashedPassword,
          role: UserRole.ADMIN,
        });
        await this.repo.save(adminUser);
        this.logger.log(`Default admin user created: ${adminEmail}`);
      }
    } catch (error) {
      // If tables don't exist yet, log as debug but don't crash app
      this.logger.debug(
        `Admin user initialization skipped (tables may not exist yet): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  createUser(userData: Partial<User>) {
    const user = this.repo.create(userData);
    return this.repo.save(user);
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }
}
