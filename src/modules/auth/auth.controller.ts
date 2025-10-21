/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from '../users/dtos/register-user.dto';
import { LoginUserDto } from '../users/dtos/login-user.dto';
import type { Request, Response } from 'express';

interface RequestWithCookies extends Request {
  cookies: Record<string, string>;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(
    @Body() loginDto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    // Set refresh token trong HTTP-only cookie (30 days)
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS trong production
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    });
    // Trả về response không có refreshToken (đã set trong cookie)
    const { refreshToken, ...response } = result;
    return response;
  }

  @Post('refresh')
  async refresh(@Req() req: RequestWithCookies) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Không tìm thấy refresh token');
    }
    return await this.authService.refreshAccessToken(refreshToken);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    // Xoá cookie refresh token
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });
    return { message: 'Đăng xuất thành công' };
  }
}
