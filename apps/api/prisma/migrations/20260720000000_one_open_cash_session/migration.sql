-- Una sola caja ABIERTA por sucursal, garantizado por la base.
--
-- `openSession` chequeaba con un SELECT y después insertaba, así que dos
-- cajeros abriendo al mismo tiempo (o un doble click) dejaban DOS sesiones OPEN.
-- Como `getOpenSession` toma la más reciente, todos los movimientos iban a esa y
-- la vieja quedaba abierta para siempre, con su monto de apertura fuera del
-- arqueo: el efectivo esperado quedaba mal y ningún cierre cuadraba el turno.
--
-- Es un índice PARCIAL (sólo sobre las filas OPEN) porque una sucursal tiene
-- muchas sesiones CLOSED históricas y ésas no deben chocar entre sí. Prisma no
-- expresa índices parciales en el schema, por eso va en SQL crudo.
--
-- Si en alguna base ya quedaron duplicadas de antes, este índice no se puede
-- crear hasta resolverlas: hay que cerrar a mano las sesiones OPEN sobrantes
-- (dejando la más reciente por sucursal) y volver a aplicar.
CREATE UNIQUE INDEX "cash_register_sessions_one_open_per_branch"
  ON "cash_register_sessions" ("branch_id")
  WHERE "status" = 'OPEN';
