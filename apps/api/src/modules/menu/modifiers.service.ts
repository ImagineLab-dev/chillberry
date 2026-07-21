import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Una línea de pedido tal como la manda el cliente (staff o comensal). */
export type IncomingLine = {
  menuItemId: string;
  quantity: number;
  modifierOptionIds?: string[];
};

/** Lo que el servidor resolvió para esa línea. */
export type ResolvedLine = {
  /** `menuItem.price + Σ priceDelta`. Invariante: `unitPrice * quantity` = total de línea. */
  unitPrice: Prisma.Decimal;
  /** Snapshot `[{groupName, optionName, priceDelta}]`, o null si no eligió nada. */
  modifiers: Prisma.JsonValue | null;
};

/**
 * Resuelve y valida los modificadores de un pedido.
 *
 * Compartido a propósito entre `OrdersService.create` (staff) y
 * `PublicMenuService.createGuestOrder` (comensal por QR): son los dos únicos
 * caminos de escritura de `OrderItem`, y duplicar esta lógica significaría que
 * tarde o temprano uno valide y el otro no — justo el camino público, que es
 * el que recibe input de gente anónima.
 *
 * Usa `PrismaService` crudo (no el tenant-scoped) porque el camino público
 * corre sin tenant en el contexto; el aislamiento se garantiza validando que
 * cada opción pertenezca a un grupo del `menuItem` de ESA línea, y esos
 * menuItems ya vienen filtrados por sucursal desde el llamador.
 */
@Injectable()
export class ModifiersService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveLines(
    lines: IncomingLine[],
    menuItemById: Map<string, { id: string; price: Prisma.Decimal }>,
  ): Promise<ResolvedLine[]> {
    const anyModifiers = lines.some((l) => l.modifierOptionIds?.length);

    // Atajo: sin modificadores no hace falta ir a la DB. Igual hay que validar
    // los grupos `required` — un producto puede exigir "punto de cocción".
    const menuItemIds = [...new Set(lines.map((l) => l.menuItemId))];
    const groups = await this.prisma.modifierGroup.findMany({
      where: { menuItemId: { in: menuItemIds }, active: true },
      include: { options: { where: { active: true } } },
    });

    if (!anyModifiers && groups.every((g) => !g.required && g.minSelect === 0)) {
      return lines.map((line) => ({
        unitPrice: menuItemById.get(line.menuItemId)!.price,
        modifiers: null,
      }));
    }

    const groupsByMenuItem = new Map<string, typeof groups>();
    for (const g of groups) {
      const list = groupsByMenuItem.get(g.menuItemId) ?? [];
      list.push(g);
      groupsByMenuItem.set(g.menuItemId, list);
    }

    return lines.map((line) => this.resolveLine(line, menuItemById, groupsByMenuItem));
  }

  private resolveLine(
    line: IncomingLine,
    menuItemById: Map<string, { id: string; price: Prisma.Decimal }>,
    groupsByMenuItem: Map<string, { id: string; name: string; required: boolean; minSelect: number; maxSelect: number; options: { id: string; name: string; priceDelta: Prisma.Decimal }[] }[]>,
  ): ResolvedLine {
    const menuItem = menuItemById.get(line.menuItemId)!;
    const itemGroups = groupsByMenuItem.get(line.menuItemId) ?? [];
    const chosenIds = new Set(line.modifierOptionIds ?? []);

    // Índice de las opciones VÁLIDAS para este producto. Si un id elegido no
    // está acá, o no existe, o está inactivo, o pertenece a otro producto —
    // sin esta validación, un cliente podría mandar el id de una opción barata
    // de otro producto y pagar de menos.
    const validOptions = new Map(itemGroups.flatMap((g) => g.options.map((o) => [o.id, { group: g, option: o }])));

    const unknown = [...chosenIds].filter((id) => !validOptions.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException('Alguna de las opciones elegidas ya no está disponible para ese producto');
    }

    const snapshot: { groupName: string; optionName: string; priceDelta: string }[] = [];
    let delta = new Prisma.Decimal(0);

    for (const group of itemGroups) {
      const chosenInGroup = group.options.filter((o) => chosenIds.has(o.id));

      if (group.required && chosenInGroup.length === 0) {
        throw new BadRequestException(`Tenés que elegir una opción de "${group.name}"`);
      }
      if (chosenInGroup.length < group.minSelect) {
        throw new BadRequestException(`Elegí al menos ${group.minSelect} opción(es) de "${group.name}"`);
      }
      if (chosenInGroup.length > group.maxSelect) {
        throw new BadRequestException(`Podés elegir hasta ${group.maxSelect} opción(es) de "${group.name}"`);
      }

      for (const option of chosenInGroup) {
        delta = delta.plus(option.priceDelta);
        snapshot.push({
          groupName: group.name,
          optionName: option.name,
          priceDelta: option.priceDelta.toString(),
        });
      }
    }

    const unitPrice = menuItem.price.plus(delta);
    // Un delta negativo mayor al precio dejaría la línea en negativo y podría
    // usarse para bajar el total del pedido entero.
    if (unitPrice.lessThan(0)) {
      throw new BadRequestException('La combinación de opciones elegida da un precio inválido');
    }

    return { unitPrice, modifiers: snapshot.length > 0 ? snapshot : null };
  }
}
