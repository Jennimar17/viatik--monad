# Auditoría de conversión de la landing

Hecha con el skill `landing-page-conversion-audit` sobre la landing de la rama `landing-improvement`, antes del rediseño (commit `b1fec12`). Las correcciones de "Fix now" ya están aplicadas en esta rama.

## Verdict

El problema está en la página, no en la oferta. La propuesta ("Fund the work. Control how capital moves.") es clara y específica. Lo que frenaba la conversión era todo lo demás:

- **13 secciones** que repetían tres veces la misma historia de roles.
- **Dos acciones primarias compitiendo**: "Get early access" y "Open demo".
- **Un formulario de waitlist que no guardaba nada** y lo decía ("This form does not send or save early-access requests"). Eso le resta credibilidad a todo lo demás.

La acción real del sitio es abrir el demo, así que la página debe empujar solo a eso.

## Fix now (ordenado por impacto esperado)

1. **CTAs del header y del cierre.** Había dos acciones primarias, y una de ellas era un waitlist falso. Ahora hay una sola acción, **Open the demo**, más "Sign in" como enlace secundario y accesos directos por rol (Investor, Agency Admin, Member) en el CTA final. Se eliminaron el waitlist y la server action `joinWaitlist`. Esfuerzo: S. Confianza: alta.
2. **Longitud y repetición.** Había 13 secciones con roles repetidos en `ProductShowcase`, `RoleProductStory` y las secciones para inversores y agencias. Quedaron hero + 7 secciones + CTA:
   - Roles en un único bloque de prismas.
   - Acuerdos, presupuestos y reconciliación en pestañas.
   - Seguridad y principios fusionados en "Controls".

   Esfuerzo: M. Confianza: alta.

3. **Prueba social inexistente.** No había ninguna, y no se puede inventar. Se agregó una barra de prueba con hechos verificables bajo el hero: USDC sobre Monad, sin wallets ni gas para el usuario, recibo en cada pago. El footer suma "Built for Monad Metropolis · Consumer Products & Payments". Esfuerzo: S. Confianza: media.
4. **"¿Para quién es?"** Faltaba la respuesta en lenguaje del visitante. Se agregó una sección de casos de uso (venture studios, grant programs, ecosystem funds, agencies, distributed teams). Cada tarjeta abre el demo con el rol correspondiente. Esfuerzo: M. Confianza: media.
5. **Footer engañoso.** "Documentation" apuntaba a `#faq` y "Contact" y "Updates" al waitlist. Ahora el footer tiene 5 grupos con enlaces reales, y las páginas futuras aparecen marcadas "Soon" sin enlace. Esfuerzo: S. Confianza: alta.
6. **FAQ con preguntas blandas.** Pasó de 9 a 7 preguntas enfocadas en objeciones (banco, wallet, control del gasto, AI Agents, Monad, retornos). Las definiciones se van a `/docs` y `/glossary`. Esfuerzo: S. Confianza: media.
7. **Navegación.** Los anchors "For investors" y "For agencies" llevaban a secciones que ahora están fusionadas. La nav nueva es How it works · Product · Use cases · Controls · Monad. Esfuerzo: S. Confianza: alta.

## Test, don't guess

- **Titular del hero.** El actual habla del mecanismo ("Control how capital moves"). Variante de resultado: "Fund teams without losing the trail". Métrica: clics en "Open the demo" por sesión.
- **CTA principal.** "Open the demo" contra "Explore as an Investor", que entra directo a un rol. Métrica: sesiones que llegan a una pantalla del producto.
- **Posición de los casos de uso.** Ahora van después de los roles. Variante: justo después del hero. Métrica: scroll depth y clics en tarjetas.

## Not a problem

- **Hero.** Promesa, mecanismo y CTA visibles en el primer viewport, tanto en 390 px como en 1440 px. La preview del producto refuerza el mensaje.
- **Accesibilidad base.** Skip link, foco visible, `prefers-reduced-motion` respetado y targets de toque de 44 px o más.
- **Rendimiento.** Fuentes locales e imágenes pre-dimensionadas. Las ilustraciones nuevas son SVG inline sin peticiones extra.
- **Copy de producto.** Es directo, sin "revolutionary" ni "seamless", y la marca no promete retornos.

## Could not check

- **Tráfico y conversiones.** No hay datos de sesiones, fuentes ni tasas, así que todo se rankeó por fricción, no por números. Con menos de unas 1.000 sesiones o 30 conversiones, un A/B no distingue señal de ruido.
- **Message match con anuncios.** No hay campañas activas.
- **Medición.** `@vercel/analytics` registra páginas vistas, pero no hay eventos de clic en CTA ni seguimiento de qué rol abre cada visitante. Recomendado: un evento `cta_click` con `{ location, role }`, si el plan de Vercel permite eventos personalizados.
