import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Market } from './entities/market.entity';
import { CreateMarketDto } from './dtos/create-market.dto';

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(Market)
    private marketRepository: Repository<Market>,
  ) {}

  async findAll(): Promise<Market[]> {
    return this.marketRepository.find();
  }

  async findBySymbol(symbol: string): Promise<Market | null> {
    return this.marketRepository.findOne({
      where: { symbol },
    });
  }
  async create(createMarketDto: CreateMarketDto): Promise<Market> {
    const { symbol } = createMarketDto;
    const existingMarket = await this.marketRepository.findOne({
      where: { symbol },
    });

    if (existingMarket) {
      throw new BadRequestException(
        `Market with symbol ${symbol} already exists.`,
      );
    }

    const newMarket = this.marketRepository.create(createMarketDto);
    return this.marketRepository.save(newMarket);
  }
}
