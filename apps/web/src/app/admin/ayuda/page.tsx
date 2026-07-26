'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, HelpCircle, Lightbulb, Search } from 'lucide-react';
import {
  ALL_ARTICLES,
  HELP_CATEGORIES,
  articleSearchText,
  type HelpArticle,
  type HelpBlock,
} from '@/lib/help-content';

/**
 * Centro de ayuda — documentación paso a paso, en texto. Master-detail: a la
 * izquierda las categorías/guías, a la derecha la guía abierta. Con buscador.
 * En móvil, la lista y la guía se alternan (con un "volver"). El contenido vive
 * en `@/lib/help-content` como datos.
 */
export default function AyudaPage() {
  const [selectedSlug, setSelectedSlug] = useState<string>(ALL_ARTICLES[0]!.slug);
  const [query, setQuery] = useState('');
  // En móvil, al tocar una guía se muestra el contenido (oculta la lista).
  const [mobileArticleOpen, setMobileArticleOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return ALL_ARTICLES.filter((a) => articleSearchText(a).includes(q));
  }, [q]);

  const article = ALL_ARTICLES.find((a) => a.slug === selectedSlug) ?? ALL_ARTICLES[0]!;

  function openArticle(slug: string) {
    setSelectedSlug(slug);
    setMobileArticleOpen(true);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
          <HelpCircle className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          Centro de ayuda
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guías paso a paso para sacarle todo el jugo a Chillberry. Buscá o elegí un tema.
        </p>
      </header>

      {/* Buscador */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en la ayuda (ej: delivery, cupón, cerrar caja)…"
          aria-label="Buscar en la ayuda"
          className="input w-full pl-9"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        {/* Navegación / resultados de búsqueda */}
        <nav className={`${mobileArticleOpen ? 'hidden md:block' : 'block'} space-y-5`} aria-label="Temas de ayuda">
          {matches ? (
            <div>
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {matches.length} resultado{matches.length === 1 ? '' : 's'}
              </p>
              {matches.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">
                  Nada coincide con “{query}”. Probá con otra palabra.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {matches.map((a) => (
                    <li key={a.slug}>
                      <ArticleLink
                        title={a.title}
                        sub={a.categoryTitle}
                        active={a.slug === selectedSlug}
                        onClick={() => openArticle(a.slug)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            HELP_CATEGORIES.map((cat) => (
              <div key={cat.id}>
                <p className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <cat.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {cat.title}
                </p>
                <ul className="space-y-0.5">
                  {cat.articles.map((a) => (
                    <li key={a.slug}>
                      <ArticleLink
                        title={a.title}
                        active={a.slug === selectedSlug}
                        onClick={() => openArticle(a.slug)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </nav>

        {/* Contenido de la guía */}
        <article className={`${mobileArticleOpen ? 'block' : 'hidden md:block'} min-w-0`}>
          <button
            type="button"
            onClick={() => setMobileArticleOpen(false)}
            className="btn btn-ghost btn-sm mb-3 md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver a los temas
          </button>

          <div className="panel p-5 sm:p-6">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">{article.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{article.summary}</p>
            <div className="mt-5 max-w-2xl space-y-4">
              {article.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

function ArticleLink({
  title,
  sub,
  active,
  onClick,
}: {
  title: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
        active ? 'bg-primary/10 font-semibold text-primary' : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        {sub && <span className="block truncate text-xs font-normal text-muted-foreground">{sub}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.type) {
    case 'p':
      return <p className="text-base leading-relaxed text-foreground/90">{block.text}</p>;
    case 'heading':
      return <h3 className="pt-2 font-heading text-base font-semibold text-foreground">{block.text}</h3>;
    case 'steps':
      return (
        <ol className="space-y-2">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-0.5 text-base leading-relaxed text-foreground/90">{it}</span>
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className="space-y-1.5">
          {block.items.map((it, i) => (
            <li key={i} className="flex gap-2.5">
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-base leading-relaxed text-foreground/90">{it}</span>
            </li>
          ))}
        </ul>
      );
    case 'tip':
      return (
        <div className="flex gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-foreground/90">{block.text}</p>
        </div>
      );
  }
}
