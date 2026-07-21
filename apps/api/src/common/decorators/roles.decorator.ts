import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@chillberry/domain';

export const ROLES_KEY = 'roles';

/**
 * Restringe un endpoint a los roles indicados. Requiere JwtAuthGuard antes
 * (RolesGuard lee `request.user.role`, seteado por el JWT strategy).
 *
 *   @Roles(USER_ROLE.Admin, USER_ROLE.Owner)
 *   @Patch(':id')
 *   update(...) { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
