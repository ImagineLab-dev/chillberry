-- Aislamiento por sucursal: cada empleado pertenece a un local.
--
-- Antes esto no existía. Cualquier empleado del restaurante podía operar sobre
-- cualquiera de sus sucursales: un cajero de un local podía cerrar el arqueo de
-- otro, registrar un retiro de efectivo contra su caja o reembolsar contra su
-- cajón. El único límite era el rol, nunca el lugar.
--
-- NULL = ve todo el restaurante. Es lo correcto para el OWNER (dueño) y es
-- además lo que deja a las cuentas ya existentes funcionando igual que hoy:
-- asignarles sucursal es un paso explícito y consciente, no un efecto colateral
-- de esta migración.
ALTER TABLE "users" ADD COLUMN "branch_id" UUID;

-- RESTRICT y no CASCADE: borrar una sucursal no puede llevarse puestos a sus
-- empleados. Hay que reasignarlos primero, y que la base lo exija es a propósito.
ALTER TABLE "users"
  ADD CONSTRAINT "users_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");
