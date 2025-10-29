/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Post,
  Body,
  Res,
  Req,
  UnauthorizedException,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterUserDto } from '../users/dtos/register-user.dto';
import { LoginUserDto } from '../users/dtos/login-user.dto';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { User } from '../users/entities/user.entity';
import { Throttle } from '@nestjs/throttler';

interface RequestWithCookies extends Request {
  cookies: Record<string, string>;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ auth: { limit: 3, ttl: 60000 } }) // 3 attempts per minute
  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.authService.register(dto);
  }

  @Throttle({ auth: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  @Post('login')
  async login(
    @Body() loginDto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);

    // Set accessToken trong HTTP-only cookie (1 hour)
    res.cookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: false, // Set false in development để test
      sameSite: 'lax', // Đổi từ 'strict' → 'lax' để cookies work
      maxAge: 60 * 60 * 1000, // 1 hour in milliseconds
      path: '/', // Explicit path
    });

    // Set refreshToken trong HTTP-only cookie (30 days)
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: false, // Set false in development để test
      sameSite: 'lax', // Đổi từ 'strict' → 'lax' để cookies work
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
      path: '/', // Explicit path
    });

    // Không trả về tokens trong response body (bảo mật)
    const { accessToken, refreshToken, ...response } = result;
    return response;
  }

  @Throttle({ auth: { limit: 10, ttl: 60000 } }) // 10 refreshes per minute
  @Post('refresh')
  async refresh(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Không tìm thấy refresh token');
    }

    const { accessToken } =
      await this.authService.refreshAccessToken(refreshToken);

    // Set new accessToken in cookie
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000, // 1 hour
      path: '/',
    });

    return { message: 'Token refreshed successfully' };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    // Xoá cả 2 cookies: accessToken và refreshToken
    res.clearCookie('accessToken', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });

    return { message: 'Đăng xuất thành công' };
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  verifyToken(@GetUser() user: User) {
    // Guard đã verify token, trả về user info
    const { passwordHash, ...safeUser } = user;
    return {
      isAuthenticated: true,
      user: safeUser,
    };
  }
}
