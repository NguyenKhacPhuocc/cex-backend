// src/modules/users/users.controller.ts
import { Controller, UseGuards, Get, Post } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { User } from './entities/user.entity';
import { UserService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Lấy thông tin user hiện tại
  @Get('me')
  getInfoUser(@GetUser() user: User) {
    return {
      user: user, // Interceptor sẽ loại bỏ passwordHash tự động
    };
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
