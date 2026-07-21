import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post()
  create(@Body() dto: CreateRestaurantDto) {
    return this.restaurants.create(dto);
  }

  // Callers: admin/restaurants y admin/branches. Mismo alcance que el ABM de
  // este mismo archivo (regla de catálogo: OWNER/ADMIN).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get()
  list() {
    return this.restaurants.list();
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.restaurants.getOrThrow(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRestaurantDto) {
    return this.restaurants.update(id, dto);
  }
}
