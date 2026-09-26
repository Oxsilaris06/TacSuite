/**
 * oi-xss-archive.test.ts — revue de sécurité côté client du 2026-09-26.
 *
 * C-1 : une archive .oi.zip forgée plaçait une valeur non échappée dans un
 * attribut `value="…"` construit en innerHTML (véhicules d'un adversaire,
 * événements de la chronologie) → rupture d'attribut, JavaScript exécuté au
 * rechargement.
 * C-2 : la fenêtre « LOG » réinjectait les lignes de console capturées en HTML
 * brut (document.write) → une chaîne non fiable journalisée devenait du code.
 * C-3 : la vérification de cohérence (étape Finalisation, ouverte à chaque
 * visite) injectait le nom d'un adversaire, un trigramme, une cellule et la
 * première hypothèse en HTML brut (alertes et synthèse).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BREAKOUT = '"><img src=x onerror="window.__oiXss=1">';

beforeEach(() => {
    document.body.innerHTML = '<div id="vehicules_c"></div><div id="time_events_container"></div>';
    Reflect.deleteProperty(window, '__oiXss');
});
afterEach(() => { document.body.innerHTML = ''; });

describe('C-1 — champs dynamiques de l’OI', () => {
    it('addDynamicField garde la valeur telle quelle, sans créer d’élément', async () => {
        await import('@oi/formulaires.js');
        window.addDynamicField('vehicules_c', BREAKOUT);
        const container = document.getElementById('vehicules_c')!;
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector<HTMLInputElement>('input.dynamic-input')?.value).toBe(BREAKOUT);
    });

    it('addTimeEvent garde heure et description telles quelles, sans créer d’élément', async () => {
        await import('@oi/formulaires.js');
        window.addTimeEvent('T1', `12:00${BREAKOUT}`, BREAKOUT);
        const container = document.getElementById('time_events_container')!;
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector<HTMLInputElement>('.time-description-input')?.value).toBe(BREAKOUT);
    });
});

describe('C-2 — fenêtre LOG de l’OI', () => {
    it('buildLogsHtml échappe chaque ligne capturée', async () => {
        const { buildLogsHtml } = await import('@oi/log-window.js');
        const html = buildLogsHtml([`[WARN] image gardée : ${BREAKOUT}`, '[LOG] RAS']);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img src=x onerror=');
        expect(html).toContain('class="warn"');
        // Ordre le plus récent en premier, comme avant.
        expect(html.indexOf('RAS')).toBeLessThan(html.indexOf('image gardée'));
    });
});

describe('C-3 — alertes et synthèse de cohérence', () => {
    it('checkCoherence affiche nom, trigramme, cellule et hypothèse comme du texte', async () => {
        await import('@oi/formulaires.js');
        const { Store } = await import('@oi/init.js');
        document.body.innerHTML = '<div id="coherence_alerts_container"></div><div id="recap_finalisation"></div>';
        const tag = '<img src=x onerror=window.__oiXss=1>';
        Store.state.formData = {
            date_op: '2026-08-01',
            adversaries: [{ id: 'a1', nom_adversaire: tag, domicile_adversaire: '' }],
            hypotheses: [tag],
            patracdvr_rows: [{ vehicle: 'VL', members: [
                { trigramme: tag, cellule: `India ${tag}`, fonction: 'Chef inter', principales: 'Sans', secondaires: 'Sans', afis: '' },
            ] }],
        } as never;

        window.checkCoherence();

        expect(document.body.querySelector('img')).toBeNull();
        expect(document.getElementById('coherence_alerts_container')!.textContent).toContain(tag);
        expect(document.getElementById('recap_finalisation')!.textContent).toContain(tag);
    });
});
