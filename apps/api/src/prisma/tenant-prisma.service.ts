import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { isTenantScopedModel } from './tenant-scoped-models';
import { tenantContext } from '../common/tenant-context/tenant-context';

const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'updateManyAndReturn',
  'aggregate',
  'groupBy',
]);
// `createManyAndReturn` y `updateManyAndReturn` existen desde Prisma 5.14 y hoy
// no los usa nadie en el repo. Van igual: el día que alguien escriba uno sobre
// un modelo con tenant, esta extensión NO lo interceptaría y la escritura
// cruzaría tenants sin un solo error. Es una línea contra un fallo silencioso.
const DATA_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

function uncapitalize(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Envuelve el PrismaClient singleton con un Client Extension que inyecta
 * `tenantId` automáticamente en toda operación sobre un modelo de
 * `TENANT_SCOPED_MODELS` — defensa en profundidad además del filtro
 * explícito que cada service ya debe aplicar.
 *
 * `findUnique`/`findUniqueOrThrow` se re-enrutan a `findFirst`/`findFirstOrThrow`
 * porque el tipo `WhereUniqueInput` no admite mezclar campos no-únicos junto
 * al identificador único — findFirst sí lo permite y devuelve el mismo shape.
 */
function extendForTenant(prisma: PrismaService, tenantId: string) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantScopedModel(model)) return query(args);

          const merged: Record<string, unknown> = { ...(args as Record<string, unknown>) };

          if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
            merged.where = { ...(merged.where as object), tenantId };
            const altOperation = operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
            const delegate = prisma[uncapitalize(model) as keyof PrismaService] as unknown as Record<
              string,
              (args: unknown) => unknown
            >;
            return delegate[altOperation]!(merged);
          }

          if (WHERE_OPERATIONS.has(operation)) {
            merged.where = { ...(merged.where as object), tenantId };
          }
          if (DATA_OPERATIONS.has(operation)) {
            merged.data = Array.isArray(merged.data)
              ? merged.data.map((item: object) => ({ ...item, tenantId }))
              : { ...(merged.data as object), tenantId };
          }
          if (operation === 'upsert') {
            merged.where = { ...(merged.where as object), tenantId };
            merged.create = { ...(merged.create as object), tenantId };
          }

          return query(merged);
        },
      },
    },
  });
}

/**
 * Singleton normal (NO request-scoped — ver nota en tenant-context.ts sobre
 * por qué request-scoped rompía el orden de guards). El tenantId se lee de
 * AsyncLocalStorage en cada acceso a `.client`, así que siempre refleja la
 * request en curso sin depender del orden de resolución de DI de Nest.
 */
@Injectable()
export class TenantPrismaService {
  constructor(private readonly prisma: PrismaService) {}

  get tenantId(): string {
    const tenantId = tenantContext.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No hay tenant en contexto de la request');
    }
    return tenantId;
  }

  get client() {
    return extendForTenant(this.prisma, this.tenantId);
  }
}
