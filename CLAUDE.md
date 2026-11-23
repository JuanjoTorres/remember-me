# Arquitectura y Reglas del Proyecto: remember.me

## 1. Visión del Producto y Dominio
- **Nombre de marca:** `remember.me`
- **Concepto:** Plataforma mobile-first de regalos digitales interactivos mediante código QR. El creador diseña una experiencia inmersiva tipo *Instagram Stories* con fotos, mensajes, notas de voz y una pregunta trivia opcional, culminando en una revelación sorpresa interactiva (efecto *rasca y gana*, billete de viaje o caja regalo).
- **Estructura de URLs del QR:** Rutas humanas y confiables bajo `/for/[slug]` (ej. `remember.me/for/sarah-x9k`).

## 2. Stack y Estructura del Monorepo
- **Monorepo:** `pnpm workspaces` + `Turborepo` bajo la carpeta raíz `remember-me/`.
- **Frontend (`apps/web`):** Next.js (App Router), TypeScript estricto, Tailwind CSS, Framer Motion, TanStack Query, `canvas-confetti`.
- **Backend (`apps/api`):** NestJS, TypeScript estricto, Prisma ORM sobre PostgreSQL.
- **Contratos (`packages/shared-types`):** Zod para esquemas de validación y generación de tipos (`z.infer`) compartidos entre front y back.
- **Infraestructura:** Preparado para desplegar `apps/web` y `apps/api` en pods Docker independientes (Kubernetes / Cloud).

## 3. Reglas de Arquitectura del Backend (`apps/api`)
- **Monolito Modular estricto:** Módulos independientes: `gifts`, `media`, `qr` y `payments`.
- **Prohibido el acoplamiento directo entre módulos:** Ningún módulo puede importar servicios ni repositorios internos de otro módulo.
- **Aislamiento del módulo `payments` (preparado para futura extracción a microservicio/pod independiente):**
  1. Sin `FOREIGN KEY` en Prisma/PostgreSQL entre `payment_orders` y `gifts` (solo campo `giftId: String` sin relación `@relation`).
  2. Comunicación exclusivamente por eventos usando una interfaz `EventBus` abstraída (implementación local con `@nestjs/event-emitter` seleccionada vía variable de entorno `EVENT_BUS_DRIVER=memory|redis`).
  3. El webhook de Stripe en `payments` emite `PaymentSucceededEvent`; el módulo `gifts` se suscribe para activar `isPremium = true` y publicar el regalo.
  4. Idempotencia obligatoria en webhooks guardando `eventId` en la tabla `payment_webhook_logs`.
- **Multimedia y QR:** Optimización de imágenes a WebP con `sharp`, subida de imágenes y audios (M4A/MP3) a almacenamiento compatible S3 (**Cloudflare R2**), y generación de códigos QR dinámicos apuntando a `https://remember.me[slug]`.

## 4. Reglas de Arquitectura del Frontend (`apps/web`)
- **Feature-Sliced / Feature-Based (`src/features/`):** `gift-creator`, `gift-experience`, `gift-reveal`, `checkout` y `shared/`.
- **Ruta crítica del QR (`app/for/[slug]`):**
  - Layout aislado a pantalla completa (`100dvh`), ultra ligero; prohibido importar componentes del editor (`gift-creator`) o librerías de Stripe aquí.
  - Precarga en segundo plano (`usePreloadMedia`) de imágenes y audios de las tarjetas siguientes mientras el usuario visualiza la actual.
  - Compresión de imágenes en cliente antes de subirlas desde `gift-creator`.
  - Flujo de creación sin registro obligatorio inicial (se captura el email en Stripe Checkout).
- **Entornos:** Diferenciar `NEXT_PUBLIC_API_URL` (navegador móvil) e `INTERNAL_API_URL` (comunicación interna SSR entre pods).

## 5. Convenciones de Código y Calidad
- Todas las variables de entorno (`development`, `staging`, `production`) deben validarse estrictamente al arrancar con Zod en `src/config/env.ts` de cada app.
- Usar siempre `pnpm` como gestor de paquetes (`pnpm --filter api ...`, `pnpm --filter web ...`).
- Antes de dar por finalizada cualquier tarea, ejecutar y verificar que `pnpm typecheck` y `pnpm build` pasan sin errores.
