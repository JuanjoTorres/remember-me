# Prompt: trabajo pendiente tras el cambio de pago al publicar, privacidad de enlaces y ciclo de vida

Escrito el 2026-11-25. Pega este documento entero como petición. Es autosuficiente: no hace falta la
conversación en la que se originó.

---

Lee `CLAUDE.md` y continúa el trabajo de la rama `feat/publish-paywall-lifecycle`. Esa rama ya contiene
(comprueba primero si está commiteada o sigue en el árbol de trabajo, y si `main` ha avanzado):

- Edición libre de borradores y muro de pago único al publicar desde la vista previa.
- Enlaces generados con terminación aleatoria de 8 caracteres; personalizados con mínimo 4.
- Freno por cliente a quien prueba enlaces (`LinkGuessGuard`) en `GET /public/gifts/:slug` y
  `GET /gifts/check-slug`.
- Bloqueo tras la entrega (`GIFT_LOCKED`), borrado irreversible, caducidad con cron diario y email de
  aniversario.

La última revisión independiente terminó en `pass`, pero dejó hallazgos no bloqueantes y decisiones del
propietario sin tomar. Este documento los recoge todos. Trabájalos **por bloques y en este orden**; cada
bloque termina con su revisión antes de empezar el siguiente.

## Reglas para todo el trabajo

- Carga la skill del área antes de editar (`backend`, `frontend`, `ops`) y abre solo la referencia que toca.
- Cada cambio de comportamiento lleva un test que falle sin el cambio.
- Ningún test se debilita, se salta ni se borra para que pase. Un fallo intermitente es un fallo: se
  investiga la causa, no se relanza.
- Las referencias de `.claude/skills` y `docs/` se actualizan en el mismo cambio. Las decisiones del
  propietario se anotan con fecha bajo `## Decisions` y, si son globales, en `CLAUDE.md`.
- Plazos, límites y precios nunca se escriben en un mensaje ni en un componente: salen de
  `packages/shared-types` o de la API.
- Textos siempre en inglés y en español.

## Requisitos mínimos para dar un bloque por terminado

1. `pnpm format:check`, `pnpm check:docs`, `pnpm lint`, `pnpm typecheck` y `pnpm build` sin errores.
2. Un agente `reviewer` nuevo (sin el contexto de quien escribió el cambio) da veredicto `pass` tras
   ejecutar él mismo `pnpm verify` completo: todos los tests tres veces sin un solo fallo y los flujos de
   navegador.
3. Si el bloque toca dependencias, lockfile, migraciones de Prisma, Dockerfiles, compose o
   `deploy/.env.example`, el revisor ejecuta además `pnpm verify:infra`.
4. El informe final dice qué revisó el agente, cuántas veces corrieron los tests y qué no se pudo
   comprobar. Los hallazgos que se decida no corregir se explican al propietario.

---

## Bloque 0 — Antes de fusionar (obligatorio)

### 0.1 Test de pagos que depende de una ventana de 600 ms

- **Dónde:** `apps/api/test/payments.test.ts`, test "leaves one payable session when a request for another
  link overtakes a slow one", y los otros dos que usan `sessionCreationDelayMs` y `vi.waitFor` con su
  tiempo por defecto.
- **Problema:** el Stripe falso responde con un temporizador. En una máquina lenta (el CI) la petición
  lenta puede terminar antes de que llegue la segunda y el test falla.
- **Requisito:** el Stripe falso retiene la respuesta en una promesa que el test libera cuando quiere; no
  queda ningún temporizador ni espera de tiempo real que decida el orden.
- **Criterios de aceptación:**
  - Los tres tests de peticiones simultáneas no contienen ningún retardo fijo.
  - El test pasa igual si se añade artificialmente una espera de 2 segundos antes de la segunda petición.
  - La suite de API pasa 5 veces seguidas (`VERIFY_TEST_RUNS=5 pnpm verify`).

### 0.2 La vista previa se abre aunque el último guardado haya fallado

- **Dónde:** `apps/web/src/features/gift-creator/useGiftEditor.ts` (`settled`, `run`) y el botón de vista
  previa en `apps/web/src/features/gift-creator/components/GiftEditor.tsx`.
- **Problema:** `run` devuelve `null` cuando el guardado falla y `settled()` se resuelve igualmente, así
  que el editor navega a la vista previa y se puede publicar sin el último cambio. Es grave para el nombre
  del destinatario, que queda fijado al publicar. Además `settled()` solo espera el cambio que era el
  último al llamarlo, no uno iniciado mientras espera.
- **Requisito:** no se navega a la vista previa si algún cambio pendiente falló; se muestra el error de
  guardado y el creador se queda en el editor. `settled()` espera hasta que no quede ningún cambio en
  curso.
- **Criterios de aceptación:**
  - Test: con un guardado que falla, pulsar "Vista previa y publicar" no navega y muestra el aviso de
    error.
  - Test: con dos guardados encadenados (el segundo iniciado mientras se espera al primero), no se navega
    hasta que termina el segundo.
  - El test existente del guardado correcto sigue pasando.

### 0.3 Commit, pull request y CI

- **Requisito:** una vez pasados 0.1 y 0.2 con su revisión, commitear en la rama, abrir el pull request y
  leer el resultado del CI. Si el CI falla donde la máquina local pasa, se investiga antes de fusionar.
- **Criterio de aceptación:** CI en verde en el mismo commit que revisó el agente.

---

## Bloque 1 — Privacidad de enlaces (decisiones del propietario)

Cada punto necesita que el propietario elija. Se indica la opción recomendada; **pregunta antes de
implementar si no hay decisión escrita en este documento o en `CLAUDE.md`**.

### 1.1 Los enlaces personalizados se pueden adivinar por nombre

- **Dónde:** `packages/shared-types/src/slug.ts` (`splitSlug`, `SlugSuffixSchema`, `CustomSlugSchema`),
  `apps/web/src/features/checkout/CustomSlugField.tsx`.
- **Problema:** la API acepta como terminación cualquier última palabra de 4 letras o más
  (`te-quiero-sarah`, `laura-2026`, `ana-love`). Solo los protege el freno por IP.
- **Opciones:**
  - **A (recomendada):** la terminación del enlace personalizado la genera siempre el sistema (aleatoria,
    6 caracteres del alfabeto sin vocales); el creador elige solo el nombre y puede pedir otra terminación
    aleatoria, no escribirla. La API rechaza cualquier terminación que no venga de ese alfabeto.
  - **B:** se mantiene la terminación escrita por el creador, pero con al menos un dígito y una letra y sin
    palabras de un diccionario corto.
  - **C:** se deja como está y se acepta el riesgo, anotándolo como decisión.
- **Criterios de aceptación (opción A):**
  - `CustomSlugSchema` rechaza `te-quiero-sarah`, `laura-2026` y `ana-love`, y acepta `laura-x9k2bd`.
  - Los enlaces personalizados ya existentes siguen abriendo su regalo (no se invalida nada publicado).
  - El campo del enlace no permite escribir la terminación; el botón de nueva terminación sigue
    funcionando y las sugerencias de `check-slug` usan la misma longitud.
  - Tests de contrato, de API (`check-slug`, checkout, `changeSlug`) y de componente actualizados.

### 1.2 Los enlaces de un regalo borrado o caducado vuelven a quedar libres

- **Dónde:** `apps/api/src/modules/gifts/gifts.service.ts` (`slugIsFree`, `freeGeneratedSlug`), tabla
  `gift_slug_aliases`.
- **Problema:** otra persona puede comprar el enlace personalizado de un regalo borrado, y un QR antiguo
  impreso abriría el regalo nuevo.
- **Opción recomendada:** retirar para siempre los enlaces de los regalos **publicados** que se borran o
  caducan (tabla propia de enlaces retirados, sin datos personales: solo el slug y la fecha). Los enlaces
  de borradores nunca publicados sí se liberan.
- **Criterios de aceptación:**
  - Tras borrar un regalo publicado, `check-slug` responde `TAKEN` para su enlace y sus alias, y ni un
    enlace generado ni uno personalizado pueden volver a tomarlo.
  - El enlace de un borrador borrado o caducado queda libre (el test actual sigue pasando).
  - Abrir un enlace retirado responde 404 y cuenta como fallo para el freno de adivinación.
  - La tabla nueva pertenece al módulo `gifts` y la migración no añade claves ajenas entre módulos.

### 1.3 Una red compartida puede bloquear a destinatarios legítimos

- **Dónde:** `apps/api/src/modules/gifts/link-guess-guard.ts`,
  `apps/api/src/modules/gifts/public-gifts.controller.ts`.
- **Problema:** 30 enlaces fallidos desde una IP compartida (operadora móvil, oficina) dejan sin acceso
  diez minutos a todos los de esa dirección.
- **Opciones:**
  - **A (recomendada si 1.1 se resuelve con la opción A):** subir el límite de fallos y dejar la entropía
    como defensa principal; el freno queda como red de seguridad.
  - **B:** mantener el límite y aceptar el riesgo, documentado.
- **Criterios de aceptación:** el valor por defecto elegido queda en `apps/api/src/config/env.ts`, en
  `.claude/skills/backend/references/config-env.md` y en `docs/deploy.md`, con la razón anotada como
  decisión.

### 1.4 Un creador que agota las comprobaciones no puede pagar el enlace personalizado

- **Dónde:** `apps/web/src/features/checkout/PremiumUpgradeSheet.tsx` (`pay`),
  `apps/web/src/features/checkout/CustomSlugField.tsx`.
- **Problema:** tras 60 comprobaciones en diez minutos, `pay()` vuelve a llamar a `checkSlug`, recibe 429
  y solo se ve el error genérico de pago.
- **Requisito:** si la comprobación responde `RATE_LIMITED`, el pago continúa (la API hace la comprobación
  definitiva al aplicar el enlace) o se muestra un mensaje propio que diga que espere unos minutos.
- **Criterios de aceptación:**
  - Test de componente: con `checkSlug` respondiendo 429, el creador ve el mensaje correcto o llega a
    Stripe; nunca el error genérico.
  - El mensaje nuevo existe en inglés y en español y no contiene cifras.

### 1.5 La vista previa enseña la experiencia de pago sin marca de agua

- **Dónde:** `apps/web/src/app/(main)/create/[giftId]/preview/PreviewScreen.tsx` (`toPreviewGift`).
- **Problema:** durante los 7 días del borrador, quien tenga el enlace de edición puede enseñar la
  experiencia completa sin pagar.
- **Opciones:**
  - **A (recomendada):** un borrador con funciones PRO sin pagar muestra en la vista previa una marca de
    agua de "vista previa" visible en la revelación final, que desaparece al pagar.
  - **B:** se acepta como coste de "probarlo todo gratis".
- **Criterios de aceptación (opción A):** test de `toPreviewGift` y de `PreviewScreen` que comprueben la
  marca en un borrador gratuito con funciones PRO y su ausencia en uno de pago; la página del destinatario
  no cambia.

---

## Bloque 2 — Reglas del regalo

### 2.1 Un regalo publicado sin nombre de destinatario no puede recibirlo nunca

- **Dónde:** `apps/api/src/modules/gifts/gifts.service.ts` (`missingToPublish`, `update`), lista `missing`
  del editor y de la vista previa.
- **Opciones:**
  - **A (recomendada):** el nombre del destinatario es obligatorio para publicar (`RECIPIENT_NAME` en
    `details.missing`).
  - **B:** se permite fijar el nombre una sola vez después de publicar, dentro de las 48 horas, si estaba
    vacío.
- **Criterios de aceptación (opción A):**
  - `POST /gifts/:giftId/publish` responde `GIFT_INCOMPLETE` con `RECIPIENT_NAME` cuando falta, y el pago
    no publica un borrador sin nombre.
  - El editor y la vista previa lo dicen en "Falta: …" y el botón queda desactivado.
  - Los regalos ya publicados sin nombre siguen funcionando.

### 2.2 La caducidad del borrador no se alarga mientras se trabaja en él

- **Problema:** un borrador que se está editando el día 7, o que está en Stripe Checkout en ese momento,
  se borra esa noche; el pago acaba en `REFUND_DUE` (reembolso manual).
- **Opción recomendada:** cada edición del borrador renueva sus 7 días, y un borrador con una orden de pago
  abierta no se borra hasta que la orden caduque. Como `gifts` no puede consultar `payments`, hazlo por
  evento (por ejemplo `checkout.started`) o alargando la caducidad al emitir el grant usado en el checkout.
- **Criterios de aceptación:**
  - Test: editar un borrador mueve `expiresAt` a 7 días desde la edición.
  - Test: un borrador con checkout abierto sobrevive a `deleteExpired` ejecutado después de su caducidad
    original.
  - Sin importaciones entre módulos; el test de arquitectura sigue pasando.

### 2.3 Subidas de archivos a un regalo bloqueado

- **Dónde:** `apps/api/src/modules/media/media.service.ts`, claims del grant en
  `apps/api/src/shared/auth/gift-grant.service.ts`.
- **Requisito:** el grant lleva si el regalo está bloqueado y `media` rechaza las subidas con
  `GIFT_LOCKED`.
- **Criterios de aceptación:** test en `apps/api/test/media-qr.test.ts` para imagen y audio sobre un regalo
  con las 48 horas pasadas; un grant antiguo sin ese dato se sigue aceptando hasta que caduca.

---

## Bloque 3 — Pagos y borrado

### 3.1 Un pago que coincide con el borrado no se marca para reembolso en el primer aviso

- **Dónde:** `apps/api/src/modules/gifts/gifts.service.ts` (`applyPayment`, líneas del `findUnique` y
  `lock`), comentario en `apps/api/src/modules/gifts/gift-lifecycle.service.ts`.
- **Problema:** si el regalo desaparece entre la lectura y el bloqueo de fila, `lock()` lanza `NOT_FOUND`
  en vez de devolver "no existe", y `payment.unapplied` no se publica hasta que Stripe reenvía el webhook.
- **Criterios de aceptación:**
  - Test que fuerce ese orden (borrado mientras el pago espera el bloqueo): la orden queda `REFUND_DUE`
    tras una sola entrega del evento.
  - El comentario del servicio de ciclo de vida describe lo que el código hace de verdad.

### 3.2 Un borrado que falla ya ha borrado el email del comprador en la orden

- **Dónde:** `GiftsService.remove` y el suscriptor `forgetCustomer` de
  `apps/api/src/modules/payments/payments.service.ts`.
- **Problema:** con el bus en memoria los suscriptores corren a la vez; si falla la limpieza de archivos el
  regalo se conserva, pero la orden ya perdió el email.
- **Opción recomendada:** aceptar y documentar (el regalo conserva su propia copia y el email de
  aniversario no se ve afectado), salvo que el propietario quiera un evento separado
  (`gift.deletion.completed`) para el borrado de datos personales.
- **Criterio de aceptación:** decisión anotada en `.claude/skills/backend/references/payments.md`; si se
  implementa el evento, test con almacenamiento caído que compruebe que el email sigue en la orden.

---

## Bloque 4 — Email de aniversario

- **Dónde:** `apps/api/src/modules/gifts/gift-lifecycle.service.ts` (`sendAnniversaryEmails`),
  `apps/api/src/shared/mail/resend-mailer.ts`, `apps/api/src/modules/gifts/anniversary-email.ts`.
- **Problemas y requisitos:**
  1. **Email perdido si el proceso muere entre reclamar y enviar.** Las reclamaciones con más de una hora
     sin confirmar se liberan en la siguiente ejecución (columna o marca de "reclamado" distinta de
     "enviado").
  2. **Duplicado tras un tiempo de espera ambiguo.** Comprobar en la documentación de Resend cuánto dura su
     clave de idempotencia y ajustar el reintento a esa ventana.
  3. **Direcciones que siempre fallan bloquean la cola.** Contador de intentos por regalo y abandono tras
     un máximo (por ejemplo 5), registrado en el log sin la dirección.
  4. **Sin opción de baja.** El email incluye una forma de no recibirlo o, como mínimo, el propietario
     confirma por escrito que el texto de privacidad basta. Es una decisión legal del propietario.
  5. **`ResendMailer` no tiene ningún test.** Test contra un servidor HTTP falso: cuerpo, cabecera
     `Idempotency-Key`, respuesta no 2xx y tiempo de espera.
- **Criterios de aceptación:**
  - Tests para cada punto: reclamación caducada que se reenvía, abandono tras el máximo de intentos sin
    bloquear a los demás, y `ResendMailer` contra el servidor falso.
  - Sigue siendo cierto que cada comprador recibe como mucho un email aunque dos instancias ejecuten el
    trabajo a la vez (el test actual sigue pasando).
  - Migración nueva si hacen falta columnas, con `pnpm verify:infra`.

---

## Bloque 5 — Despliegue (antes del primer despliegue a staging)

1. **Migración sobre datos reales.** Ejecutar la migración `20261124210813_gift_lifecycle` sobre una copia
   de la base de staging y revisar el resultado: los regalos gratuitos publicados hace más de un año
   quedarían caducados y se borrarían la primera noche.
   - **Criterio de aceptación:** recuento de filas afectadas entregado al propietario antes de desplegar;
     si existe alguna, decisión explícita (por ejemplo, darles un año desde el despliegue).
2. **Bloqueo retroactivo.** Desde el primer arranque todo regalo publicado hace más de 48 horas queda
   bloqueado, también los de pago. Confirmarlo con el propietario o fijar `lockedAt` solo para los
   publicados a partir del despliegue.
3. **Compradores anteriores sin email.** Los regalos pagados antes del cambio no tienen `customerEmail`.
   Opción: rellenarlo una vez desde Stripe con un script de operación. Decisión del propietario.
4. **Versiones distintas de web y API durante el despliegue.** `GET /gifts/slug-availability` ya no existe
   y `GiftEditorView` tiene campos nuevos obligatorios. Confirmar que el despliegue sustituye los dos
   contenedores juntos y anotarlo en `.claude/skills/ops/references/pipeline.md`.
5. **Dirección del visitante en producción.** Los límites por cliente dependen de que Caddy ponga
   `X-Forwarded-For` y de `TRUST_PROXY_HOPS: 1`.
   - **Criterio de aceptación:** en staging, dos dispositivos con IP distinta tienen presupuestos
     distintos, y 30 enlaces falsos desde uno no bloquean al otro. Resultado anotado en
     `.claude/skills/ops/references/environments.md`.
6. **Resend.** Dominio verificado, `MAIL_DRIVER=resend`, `RESEND_API_KEY` y `MAIL_FROM` en el `.env` del
   servidor. Un email de prueba real recibido en staging.
7. **Stripe real.** Comprobar en modo test que `customer_details.email` llega en el webhook para tarjeta,
   Apple Pay y Google Pay.
8. **Cron.** Comprobar en los logs de staging que los dos trabajos se ejecutan a las 03:15 y a las 09:00
   UTC (`GiftLifecycle`).

---

## Sugerencias (no imprescindibles)

- **Lógica en `app/`:** `PreviewScreen.tsx` y `PublishedScreen.tsx` contienen lógica (`toPreviewGift`, flujo
  de publicación, elección de la nota). Crear una feature `gift-preview` que pueda importar `gift-creator`,
  `checkout` y `gift-experience`, dejar las páginas como composición y añadir la fila a
  `.claude/skills/frontend/references/architecture.md`.
- **Contadores compartidos:** los límites de adivinación y de peticiones viven en memoria por instancia.
  Antes de tener dos instancias de la API, moverlos a Redis junto con el bus de eventos.
- **Vista previa en la captura:** revisar a mano en un móvil real el diseño de la vista previa (banda
  superior, barra inferior, zonas táctiles); solo está comprobada por tests, no visualmente.
- **Aviso antes de que caduque un regalo gratuito:** un email o un aviso en el editor unas semanas antes
  del año, con la oferta de conservarlo para siempre. Necesita un email del creador, que hoy solo existe en
  los regalos de pago.
- **Texto del email de aniversario:** revisión de redacción y de marca por el propietario antes de activar
  Resend.
- **Panel de operación:** un comando o consulta documentada para ver órdenes `REFUND_DUE` y regalos
  próximos a caducar.
- **Enlace de edición perdido:** con el email del comprador ya guardado, se podría reenviar el enlace de
  edición a los regalos de pago. Requiere decisión sobre el uso de ese email, que hoy la página de
  privacidad limita al recibo y al aniversario.

---

## Definición de terminado de todo el documento

- Bloque 0 fusionado con CI en verde.
- Cada punto de los bloques 1 a 4 está implementado con sus criterios de aceptación, o tiene una decisión
  del propietario anotada con fecha que dice que no se hace y por qué.
- Bloque 5 comprobado en staging y anotado en las referencias de `ops`.
- Ningún hallazgo de revisión queda sin respuesta: corregido, o explicado al propietario y decidido por él.
