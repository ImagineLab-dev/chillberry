'use client';

import { useState } from 'react';
import { TrendingDown } from 'lucide-react';

/**
 * "El costo de no cambiar": el visitante pone SUS números y ve cuánto deja por
 * año en comisiones de apps de pedidos. A propósito no trae cifras nuestras ni
 * de competidores — la cuenta es aritmética visible (ventas × %), así que no
 * promete nada que no se pueda verificar en pantalla.
 */
const PRESET_RATES = [15, 20, 25, 30];
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * El precio llega por prop desde la misma lista que pinta la sección de planes:
 * si mañana cambia el precio, no puede quedar uno viejo escondido acá.
 */
export function CommissionCalculator({ planMonthlyUsd }: { planMonthlyUsd: number }) {
  const [sales, setSales] = useState('8000');
  const [rate, setRate] = useState(25);

  const salesNum = Number(sales.replace(/\D/g, '')) || 0;
  const monthly = Math.round((salesNum * rate) / 100);
  const yearly = monthly * 12;
  const planYearly = planMonthlyUsd * 12;

  return (
    <div className="panel grid gap-6 p-6 md:grid-cols-2 md:gap-8">
      {/* ---- entradas ---- */}
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="label" htmlFor="calc-sales">
            Cuánto vendés por apps de pedidos al mes (USD)
          </label>
          {/* Sin prefijo "$": la etiqueta ya dice USD y el símbolo adentro del
              campo sólo agrega ruido. */}
          <input
            id="calc-sales"
            inputMode="numeric"
            value={nf.format(salesNum)}
            onChange={(e) => setSales(e.target.value)}
            className="input tabular w-full text-lg"
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="label mb-1">Qué comisión te cobran</legend>
          <div className="flex flex-wrap gap-2">
            {PRESET_RATES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                aria-pressed={rate === r}
                className={`btn btn-sm tabular min-h-[44px] ${rate === r ? 'btn-primary' : ''}`}
              >
                {r}%
              </button>
            ))}
          </div>
          <input
            type="range"
            min={5}
            max={40}
            step={1}
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            aria-label="Porcentaje de comisión"
            className="w-full accent-primary"
          />
        </fieldset>
      </div>

      {/* ---- resultado ---- */}
      <div className="flex flex-col justify-center gap-4 border-t border-border pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingDown className="h-4 w-4 shrink-0 text-error-foreground" aria-hidden="true" />
            Te llevan en comisiones
          </p>
          <p className="tabular font-heading text-4xl font-bold leading-tight text-error-foreground sm:text-5xl">
            ${nf.format(yearly)}
          </p>
          <p className="text-sm text-muted-foreground">
            por año · <span className="tabular">${nf.format(monthly)}</span> por mes
          </p>
        </div>

        <div className="rounded-lg bg-primary/10 p-4">
          <p className="font-heading font-semibold">Con tu propia carta online: 0 de comisión</p>
          <p className="mt-1 text-sm">
            El plan Pro cuesta <span className="tabular font-semibold">${nf.format(planYearly)}</span> al año, vendas
            10 o 10.000 pedidos.
            {yearly > planYearly && (
              <>
                {' '}
                Te quedan <span className="tabular font-semibold">${nf.format(yearly - planYearly)}</span> que hoy se
                van en comisiones.
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Tu medio de pago te sigue costando lo mismo — la comisión de la app de pedidos es la que desaparece.
          </p>
        </div>
      </div>
    </div>
  );
}
