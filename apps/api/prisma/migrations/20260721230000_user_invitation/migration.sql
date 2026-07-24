-- Invitación por mail para el alta de empleados.
--
-- Cuando el dueño crea un empleado SIN contraseña, se genera este token y se le
-- manda un mail con un link para que el propio empleado fije su clave. Mientras
-- el token no sea null, la cuenta existe pero no puede entrar (su passwordHash
-- es aleatorio). Al aceptar la invitación, el empleado pone su contraseña y el
-- token se limpia.
ALTER TABLE "users" ADD COLUMN "invitation_token" TEXT;
CREATE UNIQUE INDEX "users_invitation_token_key" ON "users"("invitation_token");
