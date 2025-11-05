/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { LoginUserDto } from '../users/dtos/login-user.dto';
import { RegisterUserDto } from '../users/dtos/register-user.dto';
import { UserService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/entities/user.entity';

interface RefreshTokenPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
  ) {}

  // Generate access token (1 hour)
  generateAccessToken(user: User): string {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
    };
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: '1h',
    });
  }

  // Generate refresh token (30 days)
  generateRefreshToken(user: User): string {
    const payload = { sub: user.id };
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '30d',
    });
  }

  async register(dto: RegisterUserDto): Promise<{ message: string; user: Partial<User> }> {
    const existing = await this.userService.findByEmail(dto.email);
    if (existing) throw new BadRequestException('User with this email already exists');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.userService.createUser({
      email: dto.email,
      passwordHash: hashed,
    });

    return {
      message: 'Registration successful',
      user: (() => {
        const { passwordHash, ...safeUser } = user;
        return safeUser;
      })(),
    };
  }

  async login(dto: LoginUserDto): Promise<{
    message: string;
    user: Partial<User>;
    accessToken: string;
    refreshToken: string;
  }> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    const match = await bcrypt.compare(dto.password, user.passwordHash);
    if (!match) throw new UnauthorizedException('Invalid email or password');

    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    return {
      message: 'Login successful',
      user: (() => {
        const { passwordHash, ...safeUser } = user;
        return safeUser;
      })(),
      accessToken,
      refreshToken,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
      const user = await this.userService.findById(payload.sub);
      if (!user) throw new UnauthorizedException('Invalid refresh token');

      const accessToken = this.generateAccessToken(user);
      return { accessToken };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
