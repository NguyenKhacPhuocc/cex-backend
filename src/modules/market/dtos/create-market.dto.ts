import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class CreateMarketDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  baseAsset: string;

  @IsString()
  @IsNotEmpty()
  quoteAsset: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  minOrderSize?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  pricePrecision?: number;
}
