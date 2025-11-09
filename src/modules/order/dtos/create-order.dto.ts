import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';
import { OrderSide, OrderType } from 'src/shared/enums';

export class CreateOrderDto {
  @IsEnum(OrderSide)
  side: OrderSide;

  @IsEnum(OrderType)
  type: OrderType;

  @IsNumber()
  @IsOptional()
  @Min(0.00001, { message: 'Price must be greater than 0' })
  price?: number;

  @IsNumber()
  @Min(0.00001, { message: 'Amount must be greater than 0' })
  amount: number;

  @IsString()
  marketSymbol: string;

  @IsEnum(['base', 'quote'])
  @IsOptional()
  inputAssetType?: 'base' | 'quote'; // 'base' = base asset (BTC), 'quote' = quote asset (USDT)

  @IsNumber()
  @IsOptional()
  @Min(0.00001, { message: 'Original quote amount must be greater than 0' })
  originalQuoteAmount?: number; // Original USDT amount when inputAssetType is 'quote' (for market orders)
}
