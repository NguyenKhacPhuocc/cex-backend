import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { MarketService } from '../market/market.service';
import { CreateMarketDto } from '../market/dtos/create-market.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly marketService: MarketService) {}

  // tạo 1 cặp thị trường mới
  @Post('market')
  @Roles(UserRole.ADMIN)
  createMarket(@Body() createMarketDto: CreateMarketDto) {
    return this.marketService.create(createMarketDto);
  }
}
