import { z } from 'zod';
import { ORDER_STATUS, ORDER_TYPE } from '@chillberry/domain';

export const CreateOrderItemSchema = z.object({
  menuItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(50),
  /** Texto libre del comensal: "sin cebolla", "bien cocido". */
  notes: z.string().max(300).optional(),
  /** IDs de las opciones elegidas — el precio lo resuelve el servidor a partir
   *  de estos ids, nunca se acepta un monto del cliente. */
  modifierOptionIds: z.array(z.string().uuid()).max(20).optional(),
});

export const CreateOrderSchema = z.object({
  branchId: z.string().uuid(),
  tableId: z.string().uuid().optional(),
  type: z.enum([ORDER_TYPE.DineIn, ORDER_TYPE.Takeaway, ORDER_TYPE.Delivery]).default(ORDER_TYPE.DineIn),
  customerName: z.string().max(120).optional(),
  customerPhone: z.string().max(30).optional(),
  notes: z.string().max(300).optional(),
  items: z.array(CreateOrderItemSchema).min(1),
});
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const UpdateOrderStatusSchema = z.object({
  status: z.enum([
    ORDER_STATUS.Waiting,
    ORDER_STATUS.Accepted,
    ORDER_STATUS.Preparing,
    ORDER_STATUS.Ready,
    ORDER_STATUS.Completed,
    ORDER_STATUS.Cancelled,
  ]),
});
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
