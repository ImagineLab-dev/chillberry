import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { USER_ROLE } from '@chillberry/domain';
import { Roles } from '../../common/decorators/roles.decorator';
import { MenuService } from './menu.service';
import { CombosService } from './combos.service';
import { ModifierAdminService } from './modifier-admin.service';
import { CreateComboDto, UpdateComboDto } from './dto/combo.dto';
import { CreateMenuCategoryDto } from './dto/create-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuCategoryDto } from './dto/update-category.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { ReorderItemsDto } from './dto/reorder-items.dto';
import { ConvertPricesDto } from './dto/convert-prices.dto';
import {
  CreateModifierGroupDto,
  CreateModifierOptionDto,
  UpdateModifierGroupDto,
  UpdateModifierOptionDto,
} from './dto/modifier.dto';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly combos: CombosService,
    private readonly modifiers: ModifierAdminService,
  ) {}

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('categories')
  createCategory(@Body() dto: CreateMenuCategoryDto) {
    return this.menu.createCategory(dto);
  }

  // Solo el ABM de menú agrupa por categoría (`app/admin/menu/page.tsx`); el
  // mesero arma el pedido con la lista plana de items y el cliente ve el menú
  // público por QR (`public/menu/:qrToken`, @Public).
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('categories')
  listCategories(@Query('branchId') branchId: string) {
    return this.menu.listCategories(branchId);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('categories/:id')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuCategoryDto) {
    return this.menu.updateCategory(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('categories/:id')
  deactivateCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deactivateCategory(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('items')
  createItem(@Body() dto: CreateMenuItemDto) {
    return this.menu.createItem(dto);
  }

  // El mesero necesita los productos para armar el pedido (`app/waiter`);
  // admin/menu y admin/orders también.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin, USER_ROLE.Waiter)
  @Get('items')
  listItems(@Query('branchId') branchId: string, @Query('includeInactive') includeInactive?: string) {
    return this.menu.listItems(branchId, includeInactive === 'true');
  }

  // Reordenar productos de una sucursal. Declarado ANTES de `items/:id` para que
  // "reorder" no lo capture el ParseUUIDPipe del param `:id`.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('items/reorder')
  reorderItems(@Body() dto: ReorderItemsDto) {
    return this.menu.reorderItems(dto.branchId, dto.orderedIds);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('items/:id')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menu.updateItem(id, dto);
  }

  // Reconvierte todos los precios del menú por un tipo de cambio (al cambiar de
  // moneda). Acción masiva sobre precios: solo OWNER/ADMIN.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('prices/convert')
  convertPrices(@Body() dto: ConvertPricesDto) {
    return this.menu.convertPrices(dto.rate);
  }

  // --- Combos (bundles a precio fijo) ---

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('combos')
  createCombo(@Body() dto: CreateComboDto) {
    return this.combos.create(dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('combos')
  listCombos(@Query('branchId') branchId: string, @Query('includeInactive') includeInactive?: string) {
    return this.combos.list(branchId, includeInactive === 'true');
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('combos/:id')
  updateCombo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateComboDto) {
    return this.combos.update(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('combos/:id')
  deactivateCombo(@Param('id', ParseUUIDPipe) id: string) {
    return this.combos.deactivate(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('items/:id')
  deactivateItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.menu.deactivateItem(id);
  }

  // -------------------------------------------------- modificadores / extras

  // El único caller es el `ModifierManager` de `app/admin/menu/page.tsx`. El
  // comentario anterior decía que este GET quedaba sin @Roles porque "el
  // mesero necesita ver las opciones para armar un pedido con extras", pero
  // `app/waiter/page.tsx` nunca lo llama, y el cliente que pide por QR recibe
  // los modificadores dentro de `public/menu/:qrToken` (@Public, otro
  // service). Era la justificación de un agujero, no un requisito real.
  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Get('items/:id/modifier-groups')
  listModifierGroups(
    @Param('id', ParseUUIDPipe) menuItemId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.modifiers.listGroups(menuItemId, includeInactive === 'true');
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('items/:id/modifier-groups')
  createModifierGroup(@Param('id', ParseUUIDPipe) menuItemId: string, @Body() dto: CreateModifierGroupDto) {
    return this.modifiers.createGroup(menuItemId, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('modifier-groups/:id')
  updateModifierGroup(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModifierGroupDto) {
    return this.modifiers.updateGroup(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('modifier-groups/:id')
  deactivateModifierGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.modifiers.deactivateGroup(id);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Post('modifier-groups/:id/options')
  createModifierOption(@Param('id', ParseUUIDPipe) groupId: string, @Body() dto: CreateModifierOptionDto) {
    return this.modifiers.createOption(groupId, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Patch('modifier-options/:id')
  updateModifierOption(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModifierOptionDto) {
    return this.modifiers.updateOption(id, dto);
  }

  @Roles(USER_ROLE.Owner, USER_ROLE.Admin)
  @Delete('modifier-options/:id')
  deactivateModifierOption(@Param('id', ParseUUIDPipe) id: string) {
    return this.modifiers.deactivateOption(id);
  }
}
