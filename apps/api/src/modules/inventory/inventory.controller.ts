import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { InventoryService } from './inventory.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { CountStockDto } from './dto/count-stock.dto';
import { SetRecipeComponentDto } from './dto/set-recipe-component.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // ------------------------------------------------------------- insumos

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('ingredients')
  listIngredients(@Query('branchId') branchId: string) {
    return this.inventory.listIngredients(branchId);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('low-stock')
  lowStock(@Query('branchId') branchId: string) {
    return this.inventory.lowStock(branchId);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('ingredients')
  create(@Body() dto: CreateIngredientDto) {
    return this.inventory.createIngredient(dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('ingredients/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateIngredientDto) {
    return this.inventory.updateIngredient(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('ingredients/:id/adjust')
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.adjustStock(id, dto, user.id);
  }

  // Conteo físico: setea el stock al valor contado (registra el delta).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('ingredients/:id/count')
  count(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CountStockDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.countStock(id, dto, user.id);
  }

  // Historial de movimientos de un insumo.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('ingredients/:id/movements')
  movements(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.listMovements(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('ingredients/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.removeIngredient(id);
  }

  // -------------------------------------------------------------- recetas

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('recipe/:menuItemId')
  getRecipe(@Param('menuItemId', ParseUUIDPipe) menuItemId: string) {
    return this.inventory.getRecipe(menuItemId);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Put('recipe/:menuItemId')
  setRecipe(@Param('menuItemId', ParseUUIDPipe) menuItemId: string, @Body() dto: SetRecipeComponentDto) {
    return this.inventory.setRecipeComponent(menuItemId, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('recipe/:menuItemId/:ingredientId')
  removeRecipe(
    @Param('menuItemId', ParseUUIDPipe) menuItemId: string,
    @Param('ingredientId', ParseUUIDPipe) ingredientId: string,
  ) {
    return this.inventory.removeRecipeComponent(menuItemId, ingredientId);
  }
}
