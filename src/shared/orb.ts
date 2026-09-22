/**
 * orb.ts — Indicateur d'attente : une sphère de points qui tourne lentement.
 *
 * Remplace le disque tournant à bord coloré, qui ne dit rien d'autre que
 * « ça tourne » et qui, à 0,8 s par tour, presse l'œil pendant qu'on attend un
 * PDF de vingt secondes. La sphère tourne en 9 secondes : elle occupe le
 * regard sans le brusquer, exactement le registre qu'on veut sur un poste de
 * commandement — l'opérateur attend, il n'est pas en train d'être pressé.
 *
 * Inspiration : les « thinking orbs » de Jakub Antalik et Alex Brinza
 * (rareformlabs.github.io/thinking-orbs), repris ici en monochrome dans
 * l'accent bleu du thème, sans dépendance ajoutée — une centaine de points,
 * un canvas, `requestAnimationFrame`.
 *
 * Trois règles de tenue :
 *   - RIEN NE TOURNE QUAND RIEN N'EST AFFICHÉ. `stop()` annule la boucle ;
 *     laisser tourner un `requestAnimationFrame` derrière un overlay masqué
 *     vide la batterie d'une tablette en intervention pour rien.
 *   - `prefers-reduced-motion` fige la sphère sur une image, sans rotation.
 *     Elle reste lisible comme « quelque chose est en cours » ; c'est la
 *     rotation, pas la forme, qui gêne.
 *   - la couleur vient des tokens du thème, lus sur l'élément : la sphère suit
 *     le thème clair comme le sombre sans seconde implémentation.
 */

/** Répartition de Fibonacci : des points régulièrement espacés sur la sphère,
 * sans les amas aux pôles que produit un maillage latitude/longitude. */
function fibonacciSphere(count: number): [number, number, number][] {
    const points: [number, number, number][] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
        const y = 1 - (i / (count - 1)) * 2;
        const radius = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = golden * i;
        points.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
    }
    return points;
}

export interface OrbHandle {
    /** Arrête la boucle d'animation. Idempotent. */
    stop(): void;
}

export interface OrbOptions {
    /** Nombre de points. 140 remplit la sphère sans la rendre laiteuse. */
    points?: number;
    /** Durée d'un tour complet, en millisecondes. */
    period?: number;
    /** Couleur des points. Par défaut, `--accent-blue` lu sur le canvas. */
    color?: string;
}

/**
 * Anime une sphère de points dans `canvas`. Rend `null` si le contexte 2D est
 * indisponible (canvas absent, jsdom) — l'appelant n'a alors rien à défaire.
 */
export function mountOrb(canvas: HTMLCanvasElement | null, options: OrbOptions = {}): OrbHandle | null {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const count = options.points ?? 140;
    const period = options.period ?? 9000;
    // Couleur explicite : on ne consulte pas le thème du tout. Sinon on lit
    // `--accent-blue` sur l'élément, sous garde — `getComputedStyle` exige un
    // vrai Element, et un environnement de test peut en fournir un factice.
    let color = options.color;
    if (color === undefined) {
        let themeColor = '';
        try { themeColor = getComputedStyle(canvas).getPropertyValue('--accent-blue').trim(); } catch { /* thème indisponible */ }
        color = themeColor || '#4f8dff';
    }

    const reduced = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || 64;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const points = fibonacciSphere(count);
    // Légère inclinaison : une sphère vue pile de face lit comme un disque.
    const tilt = 0.38;
    const cosTilt = Math.cos(tilt);
    const sinTilt = Math.sin(tilt);
    const radius = (size / 2) * 0.82;

    let frame = 0;
    let stopped = false;

    const draw = (angle: number): void => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const cx = size / 2;
        const cy = size / 2;

        for (const [px, py, pz] of points) {
            // Rotation autour de l'axe vertical, puis inclinaison de l'axe.
            const x = px * cosA + pz * sinA;
            const z0 = pz * cosA - px * sinA;
            const y = py * cosTilt - z0 * sinTilt;
            const z = py * sinTilt + z0 * cosTilt;

            // `z` va de -1 (derrière) à 1 (devant) : les points du fond sont
            // plus petits et plus pâles, ce qui donne le volume sans ombrage.
            const depth = (z + 1) / 2;
            ctx.globalAlpha = 0.12 + depth * 0.78;
            const r = 0.6 + depth * 1.3;
            ctx.beginPath();
            ctx.arc(cx + x * radius, cy + y * radius, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    };

    if (reduced) {
        // Une seule image, sans boucle : la forme suffit à dire « en cours ».
        draw(0.6);
        return { stop(): void { /* rien à annuler */ } };
    }

    const start = performance.now();
    const tick = (now: number): void => {
        if (stopped) return;
        draw(((now - start) / period) * Math.PI * 2);
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return {
        stop(): void {
            if (stopped) return;
            stopped = true;
            cancelAnimationFrame(frame);
        },
    };
}
