import { IsString, IsNumber, IsEnum, IsOptional } from 'class-validator';
import { OrderSide, OrderType } from 'src/shared/enums';

export class CreateOrderDto {
  @IsEnum(OrderSide)
  side: OrderSide;

  @IsEnum(OrderType)
  type: OrderType;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsNumber()
  amount: number;

  @IsString()
  marketSymbol: string;
}
