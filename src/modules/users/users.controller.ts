// src/modules/wallets/wallets.controller.ts
import { Controller, UseGuards, Get, Post } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // hiển thị thông tin user
  @Get('me')
  getInfoUser(): string {
    return '/api/users/me | Lấy thông tin user hiện tại | Dùng để hiển thị profile user';
  }

  // cập nhật thông tin cá nhân
  @Post('profile')
  updateProfile() {
    return '/api/users/profile | Cập nhật thông tin profile user | Dùng để cập nhật thông tin cá nhân của user | Cập nhật bảng user_profiles';
  }

  // cập nhật thông tin kyc của user
  @Post('kyc')
  updateKYC() {
    return '/api/users/kyc | Cập nhật thông tin KYC của user | Gửi thông tin xác minh KYC | Nâng kycLevel của user';
  }
}
