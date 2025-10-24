import { Controller, UseGuards, Post, Body, Get } from '@nestjs/common';
import { User, UserRole } from '../users/entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from 'src/common/decorators/get-user.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dtos/create-order.dto';
import { Order } from './entities/order.entity';

@Controller('order')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // đặt lệnh spot buy/sell
  @Post()
  @Roles(UserRole.USER)
  async createOrder(
    @GetUser() user: User,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    const order = await this.orderService.createOrder(user, createOrderDto);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user: _, ...result } = order;
    return {
      // userId: order.user.id,
      ...result,
    };
  }

  // lấy danh sách các lệnh đang mở của user, Lấy tất cả lệnh đang mở của user Lọc status = open từ Redis trước, fallback DB.
  @Get('open')
  @Roles(UserRole.USER)
  async getUserOrdersIsOpen(@GetUser() user: User): Promise<Order[]> {
    const orders = await this.orderService.getUserOrdersIsOpen(user);
    return orders;
  }

  //Lịch sử đặt lệnh (đã khớp/hủy) của user, Truy vấn PostgreSQL (orders) có status != open.
  @Get('history')
  @Roles(UserRole.USER)
  async getUserOrderHistory(@GetUser() user: User): Promise<Order[]> {
    const orders = await this.orderService.getUserOrderHistory(user);
    return orders;
  }
}
