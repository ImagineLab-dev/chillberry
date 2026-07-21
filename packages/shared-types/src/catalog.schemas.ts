import { z } from 'zod';

export const CreateRestaurantSchema = z.object({
  name: z.string().min(2).max(120),
  logoUrl: z.string().url().optional(),
});
export type CreateRestaurantInput = z.infer<typeof CreateRestaurantSchema>;

export const CreateBranchSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().min(2).max(120),
  address: z.string().min(3).max(240),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().min(6).max(30).optional(),
});
export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;

export const CreateTableSchema = z.object({
  branchId: z.string().uuid(),
  code: z.string().min(1).max(20),
  capacity: z.number().int().min(1).max(50).optional(),
});
export type CreateTableInput = z.infer<typeof CreateTableSchema>;

export const CreateMenuCategorySchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().min(1).max(80),
  sortOrder: z.number().int().min(0).default(0),
});
export type CreateMenuCategoryInput = z.infer<typeof CreateMenuCategorySchema>;

export const CreateMenuItemSchema = z.object({
  branchId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  price: z.number().nonnegative(),
  imageUrl: z.string().url().optional(),
});
export type CreateMenuItemInput = z.infer<typeof CreateMenuItemSchema>;
