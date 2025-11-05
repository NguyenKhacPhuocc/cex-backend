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
  async register(@Body() dto: RegisterUserDto) {
    return this.authService.register(dto);
  }

  @Throttle({ auth: { limit: 5, ttl: 60000 } }) // 5 attempts per minute
  @Post('login')
  async login(@Body() loginDto: LoginUserDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(loginDto);

    // Determine cookie options based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction, // true in production (HTTPS required)
      sameSite: isProduction ? ('none' as const) : ('lax' as const), // 'none' for cross-site, 'lax' for same-site
      maxAge: 60 * 60 * 1000, // 1 hour in milliseconds
      path: '/',
    };

    // Set accessToken in HTTP-only cookie (1 hour)
    res.cookie('accessToken', result.accessToken, cookieOptions);

    // Set refreshToken in HTTP-only cookie (30 days)
    res.cookie('refreshToken', result.refreshToken, {
      ...cookieOptions,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    // // Return only safe data (tokens stored in httpOnly cookies)
    // const { accessToken, refreshToken, ...safeResult } = result;
    // return safeResult;
    return result; // Bao gồm cả accessToken và refreshToken
  }

  @Throttle({ auth: { limit: 10, ttl: 60000 } }) // 10 refreshes per minute
  @Post('refresh')
  async refresh(@Req() req: RequestWithCookies, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    const { accessToken } = await this.authService.refreshAccessToken(refreshToken);

    // Determine cookie options based on environment
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
      maxAge: 60 * 60 * 1000, // 1 hour
      path: '/',
    };

    // Set new accessToken in cookie
    res.cookie('accessToken', accessToken, cookieOptions);

    return { message: 'Token refreshed successfully' };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    // Determine cookie options based on environment (must match login/refresh)
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? ('none' as const) : ('lax' as const),
      path: '/',
    };

    // Clear both cookies: accessToken and refreshToken
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);

    return { message: 'Logout successful' };
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  verifyToken(@GetUser() user: User) {
    // Guard has verified token, return user info without password
    const { passwordHash, ...safeUser } = user;
    return {
      isAuthenticated: true,
      user: safeUser,
    };
  }
}
