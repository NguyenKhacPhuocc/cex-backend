import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'secret123',
      signOptions: { expiresIn: '7d' },
    }),
    WalletsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
