import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@Injectable()
export class RestaurantsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  create(dto: CreateRestaurantDto) {
    return this.tenantPrisma.client.restaurant.create({
      data: { ...dto, tenantId: this.tenantPrisma.tenantId },
    });
  }

  list() {
    return this.tenantPrisma.client.restaurant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async getOrThrow(id: string) {
    const restaurant = await this.tenantPrisma.client.restaurant.findUnique({ where: { id } });
    if (!restaurant) throw new NotFoundException('Restaurante no encontrado');
    return restaurant;
  }

  async update(id: string, dto: UpdateRestaurantDto) {
    await this.getOrThrow(id);
    return this.tenantPrisma.client.restaurant.update({ where: { id }, data: dto });
  }
}
