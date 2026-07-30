/**
 * Serializa un objeto para incrustarlo en `<script type="application/ld+json">`
 * via `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` NO escapa `<`, `>`, `&`. Cuando el JSON lleva datos que
 * controla el tenant (nombre/direccion del restaurante, etc.) y se inyecta crudo
 * en un `<script>`, un valor con `</script>` cierra la etiqueta antes de tiempo y
 * lo que sigue se ejecuta como HTML/JS en la carta PUBLICA — stored XSS que le
 * corre a cualquier visitante (y, con las cookies de dominio, podria leer el token
 * de un staff que abra esa carta).
 *
 * Escapando `<`, `>` y `&` a secuencias `\uXXXX` (JSON valido pero inerte para el
 * parser de HTML) `</script>` ya no puede romper la etiqueta. No hace falta tocar
 * U+2028/U+2029: el contenido es `application/ld+json` (se parsea como JSON, donde
 * esos caracteres son validos), no JavaScript.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
