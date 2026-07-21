/**
 * Sonidos de notificación sintetizados con Web Audio API — sin archivos de
 * audio externos que cargar. Cada área tiene un timbre distinto para que el
 * personal reconozca de oído qué pasó sin mirar la pantalla:
 *
 *  - `new-order`  cocina: dos beeps agudos rápidos (entró un pedido)
 *  - `ready`      mesero: dos notas ascendentes tipo "listo" (pedido pronto)
 *  - `assignment` repartidor: triple beep urgente (te asignaron una entrega)
 *  - `bill`       caja: dos tonos tipo caja registradora (piden la cuenta)
 *  - `alert`      despachador: baja→alta de atención (algo requiere acción)
 */
export type SoundKind = 'new-order' | 'ready' | 'assignment' | 'bill' | 'alert';

type Note = { freq: number; start: number; dur: number; type?: OscillatorType };

// Secuencias por tipo (tiempos en segundos desde el inicio del sonido).
const SEQUENCES: Record<SoundKind, Note[]> = {
  'new-order': [
    { freq: 880, start: 0, dur: 0.12 },
    { freq: 880, start: 0.16, dur: 0.18 },
  ],
  ready: [
    { freq: 660, start: 0, dur: 0.14 },
    { freq: 990, start: 0.15, dur: 0.22 },
  ],
  // Repartidor en la calle, mirando poco la pantalla: triple beep más largo y
  // penetrante para que no se pierda una asignación.
  assignment: [
    { freq: 990, start: 0, dur: 0.12 },
    { freq: 990, start: 0.18, dur: 0.12 },
    { freq: 1320, start: 0.36, dur: 0.28 },
  ],
  bill: [
    { freq: 1245, start: 0, dur: 0.09, type: 'square' },
    { freq: 1660, start: 0.1, dur: 0.16, type: 'square' },
  ],
  alert: [
    { freq: 520, start: 0, dur: 0.14 },
    { freq: 780, start: 0.16, dur: 0.24 },
  ],
};

/** Reproduce el sonido de la notificación del área dada. No-op sin Web Audio. */
export function playSound(kind: SoundKind = 'new-order') {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
    const notes = SEQUENCES[kind] ?? SEQUENCES['new-order'];
    let end = 0;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type ?? 'sine';
      osc.frequency.value = n.freq;
      const t0 = ctx.currentTime + n.start;
      // Envolvente corta con decaimiento exponencial: evita el "click" de un
      // corte abrupto y da un sonido más limpio.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + n.dur);
      end = Math.max(end, n.start + n.dur);
    }
    // Cerrar el contexto cuando terminó todo (libera el recurso de audio).
    window.setTimeout(() => ctx.close().catch(() => {}), (end + 0.1) * 1000);
  } catch {
    // Navegador sin soporte de Web Audio — el sonido no es crítico, seguimos.
  }
}

/**
 * Alias histórico: varias pantallas ya importaban `playNewOrderBeep`. Se
 * mantiene para no romper esos imports; equivale a `playSound('new-order')`.
 */
export function playNewOrderBeep() {
  playSound('new-order');
}
