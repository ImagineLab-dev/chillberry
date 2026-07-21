'use client';

import { use, useEffect, useState } from 'react';
import { CheckCircle2, Star } from 'lucide-react';
import { Alert, Skeleton } from '@/components/ui';

type Survey = {
  restaurantName: string;
  branchName: string;
  brandColor: string | null;
  completed: boolean;
  rating: number | null;
  comment: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';

const RATING_LABEL: Record<number, string> = {
  1: 'Muy mala',
  2: 'Mala',
  3: 'Regular',
  4: 'Buena',
  5: '¡Excelente!',
};

export default function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/public/feedback/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error('No encontramos esta encuesta');
        return res.json();
      })
      .then((data: Survey) => {
        setSurvey(data);
        if (data.completed) setDone(true);
      })
      .catch((err) => setError((err as Error).message));
  }, [token]);

  async function onSubmit() {
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/public/feedback/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? 'No pudimos guardar tu opinión');
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Color de marca del restaurante para las estrellas/botón; cae al violeta.
  const accent = survey?.brandColor || 'var(--primary, #d41c6f)';
  const shown = hover || rating;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="panel w-full max-w-sm p-6 text-center">
        {error && !survey && (
          <Alert tone="error" className="text-left">
            {error}
          </Alert>
        )}

        {!survey && !error && (
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-52" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {survey && done && (
          <div className="animate-fade-in flex flex-col items-center">
            <CheckCircle2 className="mb-4 h-16 w-16" style={{ color: accent }} />
            <h1 className="font-heading text-xl font-semibold text-foreground">¡Gracias por tu opinión!</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Nos ayuda muchísimo a mejorar la atención en {survey.restaurantName}.
            </p>
          </div>
        )}

        {survey && !done && (
          <div className="animate-fade-in">
            <p className="text-sm text-muted-foreground">{survey.restaurantName}</p>
            <h1 className="mb-1 mt-1 font-heading text-xl font-semibold text-foreground">
              ¿Cómo fue tu experiencia?
            </h1>
            <p className="mb-5 text-sm text-muted-foreground">Tu opinión nos ayuda a mejorar la atención.</p>

            {/* Estrellas 1-5 */}
            <div className="mb-1 flex justify-center gap-1.5" role="group" aria-label="Calificación en estrellas">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHover(star)}
                  onMouseLeave={() => setHover(0)}
                  aria-label={`${star} estrella${star > 1 ? 's' : ''}`}
                  aria-pressed={rating === star}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className="h-10 w-10"
                    style={{
                      color: accent,
                      fill: star <= shown ? accent : 'transparent',
                      opacity: star <= shown ? 1 : 0.4,
                    }}
                  />
                </button>
              ))}
            </div>
            <p className="mb-4 h-5 text-sm font-medium text-foreground">{shown ? RATING_LABEL[shown] : ' '}</p>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="¿Querés contarnos algo más? (opcional)"
              maxLength={1000}
              rows={3}
              className="input mb-4 w-full resize-none text-base"
              aria-label="Comentario"
            />

            {error && (
              <Alert tone="error" className="mb-3 text-left">
                {error}
              </Alert>
            )}

            <button
              type="button"
              onClick={onSubmit}
              disabled={rating < 1 || submitting}
              className="btn btn-primary w-full"
              style={rating >= 1 ? { backgroundColor: accent, borderColor: accent } : undefined}
            >
              {submitting ? 'Enviando...' : 'Enviar opinión'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
