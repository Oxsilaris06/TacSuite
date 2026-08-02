import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * tests/e2e/offline.spec.ts — Test PWA offline (Phase 4.B).
 * ================================================================
 * Scénario : visite des 3 pages en ligne (le Service Worker précache le
 * manifest buildé, cf. public/sw.ts + vite.config.ts), puis rechargement de
 * chacune hors ligne.
 *
 * IMPORTANT : ce test cible le serveur de PREVIEW (build + `vite preview`,
 * port 9678 — cf. playwright.config.ts `use.baseURL`), PAS `npm run dev`.
 * `registerServiceWorker` (src/shared/register-sw.ts) saute volontairement
 * l'enregistrement en dev (`import.meta.env.DEV`) : aucun `sw.js` n'y est
 * buildé, l'enregistrement y échouerait toujours. Avant d'exécuter ce
 * fichier : `npm run build && npm run preview -- --port 9678`.
 *
 * Signal d'attente : plutôt qu'un délai fixe, on attend
 * `navigator.serviceWorker.controller` — non-null seulement après que
 * `self.clients.claim()` (public/sw.ts, handler `activate`) a pris effet,
 * ce qui ne peut arriver qu'une fois l'étape `install` (précache complet,
 * ~38 entrées) entièrement résolue (contrat du cycle de vie SW : `activate`
 * ne démarre qu'après la résolution de tous les `waitUntil` d'`install`).
 */

const PAGES = ['/', '/pctac/', '/oi/'] as const;

async function waitForServiceWorkerControl(page: Page): Promise<void> {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
        timeout: 10_000,
    });
}

async function primeCache(context: BrowserContext): Promise<void> {
    const page = await context.newPage();
    for (const url of PAGES) {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `GET ${url} (amorçage cache)`).toBe(200);
        await waitForServiceWorkerControl(page);
    }
    await page.close();
}

test.describe('PWA offline', () => {
    /**
     * Test 1 : première visite en ligne des 3 pages → chaque page se charge
     * et le Service Worker finit par contrôler la page (précache peuplé).
     */
    test('should load all pages online and populate cache', async ({ page }) => {
        for (const url of PAGES) {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
            expect(response?.status(), `GET ${url}`).toBe(200);
            await expect(page.locator('body')).toBeVisible({ timeout: 5000 });
            await waitForServiceWorkerControl(page);
        }
    });

    /**
     * Test 2 : hors ligne → rechargement des 3 pages via le secours du SW
     * (chacune sert SA PROPRE copie précachée, cf. public/sw.ts §3).
     */
    test('should load pages offline via service worker', async ({ context }) => {
        await primeCache(context);

        await context.setOffline(true);

        for (const url of PAGES) {
            const page = await context.newPage();
            const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

            // Le SW sert la page précachée (200) ; à défaut, secours texte (503) —
            // dans tous les cas, jamais une erreur de navigation réseau brute.
            expect([200, 503]).toContain(response?.status());

            // Le DOM a du contenu réel (pas une page d'erreur vide du navigateur).
            const bodyHtml = await page.locator('body').innerHTML();
            expect(bodyHtml.length).toBeGreaterThan(50);

            await page.close();
        }

        await context.setOffline(false);
    });

    /**
     * Test 3 : retour en ligne → les 3 pages se rechargent normalement.
     */
    test('should recover online and reload pages', async ({ context }) => {
        await context.setOffline(false);

        const page = await context.newPage();
        for (const url of PAGES) {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
            expect(response?.status(), `GET ${url}`).toBe(200);
        }
        await page.close();
    });
});
