# Arquitectura y Reglas del Proyecto: remember.me

## 1. Visión del Producto y Dominio
- **Nombre de marca:** `kardoo.me` (definido una sola vez en `apps/web/src/features/shared/brand.ts`). El proyecto nació como `remember.me`; ese nombre se conserva solo en identificadores internos: repositorio, scope `@remember-me/*`, base de datos y bucket local.
- **Concepto:** Plataforma mobile-first de regalos digitales interactivos mediante código QR. El creador diseña una experiencia inmersiva tipo *Instagram Stories* con fotos, mensajes, notas de voz y una pregunta trivia opcional, culminando en una revelación sorpresa interactiva (efecto *rasca y gana*, billete de viaje o caja regalo).
- **Estructura de URLs del QR:** Rutas humanas y confiables bajo `/for/[slug]` (ej. `kardoo.me/for/sarah-x9k`).

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
- **Multimedia y QR:** Optimización de imágenes a WebP con `sharp`, subida de imágenes y audios (M4A/MP3) a almacenamiento compatible S3 (**Cloudflare R2**), y generación de códigos QR dinámicos apuntando a `<WEB_ORIGIN>/for/[slug]` (en producción `https://kardoo.me/for/[slug]`).

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

## 6. Skills por área y documentación viva
El conocimiento detallado del repo vive en `.claude/skills/<área>/`: un `SKILL.md` corto con las reglas del área y una tabla que dirige a **una** referencia por tipo de cambio (`references/*.md`). Este archivo solo contiene las reglas globales.

| Si vas a tocar… | Skill | Ejemplos de referencias |
| --- | --- | --- |
| `apps/api/**`, `packages/shared-types/**` | `backend` | `endpoints.md`, `payments.md`, `events.md`, `database.md`, `contracts.md`, `config-env.md` |
| `apps/web/**` | `frontend` | `routes.md`, `gift-creator.md`, `checkout.md`, `gift-experience.md`, `i18n-and-brand.md`, `ui-system.md` |
| `deploy/**`, `.github/**`, `scripts/**`, `compose.yaml`, Dockerfiles, `docs/deploy.md`, o cualquier operación en un servidor | `ops` | `environments.md`, `pipeline.md`, `stack.md`, `operations.md`, `local.md` |

- **Cargar antes de editar:** antes de modificar un archivo de un área hay que cargar su skill y abrir solo la referencia que corresponde al cambio. El hook `.claude/hooks/skill-gate.mjs` (configurado en `.claude/settings.json`) rechaza la edición si la skill no se ha cargado en la sesión. Un cambio que cruza áreas (p. ej. un endpoint nuevo y su pantalla) carga las dos.
- **Contexto mínimo:** no leer todas las referencias "por si acaso". Para explorar, usar la tabla del `SKILL.md`; para un cambio, la referencia indicada y los archivos que esta señala.
- **Son documentos vivos:** las referencias forman parte del código. Si un cambio añade, elimina, renombra o altera algo que una referencia describe (endpoint, evento, tabla, variable de entorno, código de error, contrato, ruta, componente compartido, mensaje, job del pipeline, servicio, tarea programada…), se actualiza esa referencia **en el mismo commit**.
- **Decisiones del propietario:** cuando el propietario diga "esto se hace así", se anota en la referencia correspondiente bajo `## Decisions` con la fecha, y si es una regla global, también aquí.
- **Si la referencia y el código discrepan, manda el código:** se corrige la referencia y se avisa.
- **Parte nueva del sistema:** si aparece un módulo, feature o pieza de infraestructura que ninguna referencia cubre, se crea su referencia y se añade a la tabla del `SKILL.md`; si aparece un área nueva, se crea su skill y se añade su ruta al hook.
- **Verificación:** `pnpm check:docs` falla si una skill nombra un archivo que ya no existe. Se ejecuta en CI y forma parte de las comprobaciones finales junto con `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` y `pnpm test`.
- Las skills y referencias se escriben en inglés, como el resto del repositorio.
