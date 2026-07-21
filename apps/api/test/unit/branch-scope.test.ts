import { describe, expect, it } from 'vitest';
import { USER_ROLE } from '@chillberry/domain';
import {
  assertPuedeUsarSucursal,
  sucursalParaFiltrar,
  veTodasLasSucursales,
} from '../../src/common/security/branch-scope';

const CENTRO = 'branch-centro';
const SHOPPING = 'branch-shopping';

const dueño = { role: USER_ROLE.Owner, branchId: null };
const gerenteCentro = { role: USER_ROLE.Admin, branchId: CENTRO };
const cajeroCentro = { role: USER_ROLE.Cashier, branchId: CENTRO };
const mozoSinAsignar = { role: USER_ROLE.Waiter, branchId: null };

describe('veTodasLasSucursales', () => {
  it('el dueño ve todo', () => {
    expect(veTodasLasSucursales(dueño)).toBe(true);
  });

  it('el gerente NO', () => {
    expect(veTodasLasSucursales(gerenteCentro)).toBe(false);
  });

  it('un empleado sin sucursal asignada ve todo — cuentas viejas siguen andando', () => {
    expect(veTodasLasSucursales(mozoSinAsignar)).toBe(true);
  });
});

describe('assertPuedeUsarSucursal', () => {
  it('deja al gerente operar en SU sucursal', () => {
    expect(() => assertPuedeUsarSucursal(gerenteCentro, CENTRO)).not.toThrow();
  });

  it('BLOQUEA al gerente en otra sucursal', () => {
    expect(() => assertPuedeUsarSucursal(gerenteCentro, SHOPPING)).toThrow();
  });

  it('BLOQUEA al cajero contra la caja de otra sucursal', () => {
    // Este es el caso concreto que motivó todo: un cajero cerrando el arqueo
    // de otro local, o reembolsando contra su cajón.
    expect(() => assertPuedeUsarSucursal(cajeroCentro, SHOPPING)).toThrow();
  });

  it('el dueño pasa en cualquiera', () => {
    expect(() => assertPuedeUsarSucursal(dueño, SHOPPING)).not.toThrow();
    expect(() => assertPuedeUsarSucursal(dueño, CENTRO)).not.toThrow();
  });

  it('bloquea cuando el recurso no tiene sucursal y el usuario sí', () => {
    // Fail-closed: si no se puede demostrar que es suyo, no pasa.
    expect(() => assertPuedeUsarSucursal(gerenteCentro, null)).toThrow();
    expect(() => assertPuedeUsarSucursal(gerenteCentro, undefined)).toThrow();
  });
});

describe('sucursalParaFiltrar', () => {
  it('al atado le devuelve LA SUYA aunque pida otra', () => {
    expect(sucursalParaFiltrar(gerenteCentro, SHOPPING)).toBe(CENTRO);
  });

  it('al atado le devuelve la suya aunque NO pida ninguna', () => {
    // El agujero grande: sin esto el parámetro ausente sale del where de Prisma
    // y la consulta devuelve el restaurante entero, sin ningún error.
    expect(sucursalParaFiltrar(gerenteCentro, undefined)).toBe(CENTRO);
    expect(sucursalParaFiltrar(gerenteCentro, null)).toBe(CENTRO);
  });

  it('al dueño le respeta lo que pida', () => {
    expect(sucursalParaFiltrar(dueño, SHOPPING)).toBe(SHOPPING);
  });

  it('al dueño sin filtro le devuelve undefined — ve todas', () => {
    expect(sucursalParaFiltrar(dueño, undefined)).toBeUndefined();
  });
});
