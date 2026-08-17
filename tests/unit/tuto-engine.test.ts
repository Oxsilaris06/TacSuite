/**
 * tuto-engine.test.ts — TDD du moteur `PocheTuto` (P1.A3).
 *
 * Les assertions sont fondées sur le comportement OBSERVÉ de l'original
 * (`modules/tuto-engine.js`, GStart-main, lecture seule) : le fichier a été
 * exécuté tel quel dans un bac à sable jsdom (hors de ce dépôt, aucune
 * écriture dans GStart-main) pour vérifier les points non triviaux avant
 * d'écrire les assertions ci-dessous — notamment :
 *   - `document.readyState` vaut déjà `'complete'` dans l'environnement
 *     jsdom de Vitest, donc `PocheTuto.mount()` appelle `mountButton()`
 *     SYNCHRONEMENT (branche `else` de `ready()`, tuto-engine.js:42-46) ;
 *   - `getBoundingClientRect()` et `offsetParent` sont neutres par défaut
 *     sous jsdom (rect à 0, offsetParent `null`), ce qui rend `isVisible()`
 *     TOUJOURS `false` sauf mock explicite — exploité pour tester la garde
 *     de `startSpot` sans mocker le layout ;
 *   - le quirk `injectStyles` (le second appel modifie `style` sur
 *     l'élément `<style>` lui-même, pas son `textContent`) ;
 *   - le fallback de titre du FAB passe par `esc()`, celui du dock non.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PocheTutoConfig } from '@shared/types/contracts';
import type { TutoData } from '@shared/types/tuto';

const STYLE_ID = 'ptuto-styles';

function makeData(): TutoData {
  return {
    intro: { title: 'Titre intro', text: 'Texte intro (non lu par le moteur)' },
    chapters: [
      {
        id: 'c1',
        icon: 'star',
        title: 'Chapitre un',
        summary: 'Résumé du chapitre un',
        steps: [
          {
            title: 'Étape 1.1',
            body: 'Corps **gras** de 1.1',
            terms: ['alpha'],
            selector: null,
            tip: null,
          },
          {
            title: 'Étape 1.2',
            body: 'Corps 1.2',
            terms: [],
            selector: '#spot-target',
            tip: 'Astuce **soulignée**',
          },
        ],
      },
      {
        id: 'c2',
        icon: 'flag',
        title: 'Chapitre deux',
        summary: '',
        steps: [
          { title: 'Étape 2.1', body: 'Corps 2.1', terms: ['beta', 'gamma'], selector: null, tip: null },
        ],
      },
    ],
  };
}

function baseConfig(overrides: Partial<PocheTutoConfig> = {}): PocheTutoConfig {
  return {
    appId: 'test',
    appName: 'App de test',
    data: makeData(),
    ...overrides,
  };
}

async function freshPocheTuto() {
  // Chaque test importe une instance fraîche du module (window.PocheTuto
  // remis à zéro) pour ne pas dépendre de l'ordre d'exécution des fichiers.
  vi.resetModules();
  const mod = await import('@shared/tuto-engine');
  return mod.PocheTuto;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll(`#${STYLE_ID}`).forEach((n) => n.remove());
  localStorage.clear();
  vi.useRealTimers();
  // window persiste entre les tests d'un même fichier (contrairement au
  // registre de modules réinitialisé par vi.resetModules()) : on retire la
  // façade pour que chaque test observe un PocheTuto fraîchement importé.
  Reflect.deleteProperty(window, 'PocheTuto');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PocheTuto.mount — garde-fous', () => {
  it("retourne undefined et avertit si cfg est absent", async () => {
    const PocheTuto = await freshPocheTuto();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = PocheTuto.mount(undefined as unknown as PocheTutoConfig);
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[PocheTuto] configuration manquante');
  });

  it("retourne undefined et avertit si cfg.data est absent", async () => {
    const PocheTuto = await freshPocheTuto();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = PocheTuto.mount({ appId: 'x' } as unknown as PocheTutoConfig);
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('retourne une instance et la mémorise sur PocheTuto._inst', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig());
    expect(instance).toBeDefined();
    expect(PocheTuto._inst).toBe(instance);
  });
});

describe('Façade window.PocheTuto', () => {
  it('pose window.PocheTuto au chargement du module', async () => {
    const PocheTuto = await freshPocheTuto();
    expect(window.PocheTuto).toBe(PocheTuto);
  });

  it('est idempotente : ne réécrase pas une valeur déjà présente (comme l’IIFE d’origine)', async () => {
    vi.resetModules();
    const sentinel = { mount: () => undefined } as unknown as typeof window.PocheTuto;
    window.PocheTuto = sentinel;
    await import('@shared/tuto-engine');
    expect(window.PocheTuto).toBe(sentinel);
  });
});

describe('Construction de la liste plate (flat)', () => {
  it('indexe ci/si/gi dans l’ordre des chapitres puis des steps', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    expect(instance.flat.map((f) => [f.ci, f.si, f.gi])).toEqual([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 2],
    ]);
    expect(instance.flat[0]?.chapter.id).toBe('c1');
    expect(instance.flat[2]?.chapter.id).toBe('c2');
  });

  it('storeKey utilise appId, ou "app" par défaut', async () => {
    const PocheTuto = await freshPocheTuto();
    const withId = PocheTuto.mount(baseConfig({ appId: 'pctac' }))!;
    expect(withId.storeKey).toBe('ptuto_pctac');

    vi.resetModules();
    const PocheTuto2 = await freshPocheTuto();
    const withoutId = PocheTuto2.mount(baseConfig({ appId: undefined }))!;
    expect(withoutId.storeKey).toBe('ptuto_app');
  });

  it('pos démarre à 0 et viewed est vide sans progression persistée', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    expect(instance.pos).toBe(0);
    expect(instance.viewed.size).toBe(0);
  });

  it('tolère une clé "_seen" corrompue en localStorage (viewed vide)', async () => {
    localStorage.setItem('ptuto_test_seen', '{not json');
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    expect(instance.viewed.size).toBe(0);
  });
});

describe('injectStyles', () => {
  it('injecte un unique <style id="ptuto-styles"> contenant les classes ptuto-*', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig({ accent: '#123456' }));
    const styles = document.head.querySelectorAll(`#${STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain(':root{ --ptuto-accent:#123456; }');
    expect(styles[0]?.textContent).toContain('.ptuto-overlay');
    expect(styles[0]?.textContent).toContain('.ptuto-spot-target');
  });

  it('accent par défaut #4f8dff si non fourni', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig({ accent: undefined }));
    const style = document.getElementById(STYLE_ID);
    expect(style?.textContent).toContain(':root{ --ptuto-accent:#4f8dff; }');
  });

  it("quirk d'origine : un second mount ne recrée pas le <style> et ne change PAS son textContent, seulement l'attribut style de l'élément lui-même", async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig({ accent: '#111111' }));
    const style = document.getElementById(STYLE_ID)!;
    const textBefore = style.textContent;
    expect(style.getAttribute('style')).toBeNull();

    PocheTuto.mount(baseConfig({ accent: '#ff0000' }));
    const stylesAfter = document.head.querySelectorAll(`#${STYLE_ID}`);
    expect(stylesAfter).toHaveLength(1); // toujours un seul <style>, jamais dupliqué
    expect(style.textContent).toBe(textBefore); // contenu CSS inchangé (quirk préservé)
    expect(style.getAttribute('style')).toContain('--ptuto-accent: #ff0000');
  });
});

describe('mountButton — intégration au dock ou repli FAB', () => {
  it('s’insère dans le dock existant après l’ancre insertAfter, avec les attributs attendus', async () => {
    document.body.innerHTML =
      '<div id="dockMenu"><button id="dockToggleBtn">toggle</button><button id="after">after</button></div>';
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(
      baseConfig({
        appId: 'pctac',
        appName: 'PC-Tac',
        dock: {
          selector: '#dockMenu',
          insertAfter: '#dockToggleBtn',
          itemClass: 'dock-menu-item',
          icon: 'menu_book',
        },
      }),
    );
    const item = document.getElementById('ptutoDockBtn');
    expect(item).not.toBeNull();
    expect(item?.tagName).toBe('DIV');
    expect(item?.className).toBe('dock-menu-item ptuto-dock ptuto-pulse');
    expect(item?.getAttribute('role')).toBe('button');
    expect(item?.getAttribute('tabindex')).toBe('0');
    expect(item?.getAttribute('aria-label')).toBe('Ouvrir le tutoriel');
    expect(item?.title).toBe('Tutoriel interactif — PC-Tac');
    // inséré juste après #dockToggleBtn, avant #after
    const dock = document.getElementById('dockMenu')!;
    expect(Array.from(dock.children).map((c) => c.id)).toEqual([
      'dockToggleBtn',
      'ptutoDockBtn',
      'after',
    ]);
  });

  it('ajoute le pulse et pose le flag "_greeted" seulement au premier montage', async () => {
    document.body.innerHTML = '<div id="dockMenu"></div>';
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(
      baseConfig({ appId: 'pulse', dock: { selector: '#dockMenu' } }),
    )!;
    expect(document.getElementById('ptutoDockBtn')?.classList.contains('ptuto-pulse')).toBe(true);
    expect(localStorage.getItem('ptuto_pulse_greeted')).toBe('1');

    // second appel explicite : le nouvel item ne doit plus recevoir le pulse
    instance.mountButton();
    const items = document.querySelectorAll('#dockMenu .ptuto-dock');
    expect(items).toHaveLength(2);
    expect(items[1]?.classList.contains('ptuto-pulse')).toBe(false);
  });

  it('replie sur un bouton flottant .ptuto-fab si dock.selector est absent ou introuvable', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig({ appId: 'oi', appName: 'OI - ADI', buttonLabel: 'Tuto' }));
    const fab = document.querySelector('.ptuto-fab');
    expect(fab).not.toBeNull();
    expect(fab?.tagName).toBe('BUTTON');
    expect(fab?.getAttribute('type')).toBe('button');
    expect(fab?.getAttribute('aria-label')).toBe('Ouvrir le tutoriel');
    expect(fab?.textContent).toContain('Tuto');
  });

  it("quirk d'origine : le titre de repli du FAB passe par esc(), celui du dock non", async () => {
    document.body.innerHTML = '<div id="dockMenu"></div>';
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(
      baseConfig({ appId: 'dockesc', appName: 'A & B', dock: { selector: '#dockMenu' } }),
    );
    // dock : pas d'échappement sur .title (propriété DOM, pas innerHTML)
    expect(document.getElementById('ptutoDockBtn')?.title).toBe('Tutoriel interactif — A & B');

    vi.resetModules();
    const PocheTuto2 = await freshPocheTuto();
    PocheTuto2.mount(baseConfig({ appId: 'fabesc', appName: 'A & B' }));
    // FAB : esc() appliqué avant concaténation, mais assigné à .title (propriété, pas HTML)
    // donc le texte visible contient l'entité littéralement échappée (espaces conservés).
    expect(document.querySelector('.ptuto-fab')?.getAttribute('title')).toBe(
      'Tutoriel interactif — A &amp; B',
    );
  });
});

describe('open / close', () => {
  it("ouvre au step 0 par défaut, affiche l'overlay et déclenche le rendu", async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    const overlay = document.querySelector('.ptuto-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains('ptuto-show')).toBe(true);
    expect((overlay as HTMLElement).style.display).toBe('flex');
    expect(instance.pos).toBe(0);
    expect(document.querySelector('.ptuto-step-title')?.textContent).toBe('Étape 1.1');
  });

  it('open(gi) saute directement à un index global donné', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open(2);
    expect(instance.pos).toBe(2);
    expect(document.querySelector('.ptuto-step-title')?.textContent).toBe('Étape 2.1');
  });

  it('sans argument, reprend la position persistée si elle est valide', async () => {
    localStorage.setItem('ptuto_test_pos', '1');
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(instance.pos).toBe(1);
  });

  it('ignore une position persistée hors bornes et retombe sur 0', async () => {
    localStorage.setItem('ptuto_test_pos', '99');
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(instance.pos).toBe(0);
  });

  it('close() retire ptuto-show, masque après 180ms et sauvegarde la position', async () => {
    vi.useFakeTimers();
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open(1);
    instance.close();
    const overlay = document.querySelector('.ptuto-overlay') as HTMLElement;
    expect(overlay.classList.contains('ptuto-show')).toBe(false);
    expect(overlay.style.display).toBe('flex'); // pas encore masqué
    vi.advanceTimersByTime(180);
    expect(overlay.style.display).toBe('none');
    expect(localStorage.getItem('ptuto_test_pos')).toBe('1');
  });

  it('réinitialise la recherche à chaque ouverture', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.ptuto-results')).not.toBeNull();

    instance.open();
    expect(input.value).toBe('');
    expect(document.querySelector('.ptuto-search')?.classList.contains('has-text')).toBe(false);
    expect(document.querySelector('.ptuto-step-title')).not.toBeNull();
  });
});

describe('navigation go/jump', () => {
  it('go(1) avance d’un step et met à jour le rendu', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.go(1);
    expect(instance.pos).toBe(1);
    expect(document.querySelector('.ptuto-step-title')?.textContent).toBe('Étape 1.2');
  });

  it('go(-1) au premier step reste bloqué à 0 (clamp bas)', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.go(-1);
    expect(instance.pos).toBe(0);
  });

  it('go(1) au-delà du dernier step ferme le tutoriel au lieu de dépasser', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open(2); // dernier step (gi=2)
    instance.go(1);
    expect(document.querySelector('.ptuto-overlay')?.classList.contains('ptuto-show')).toBe(false);
  });

  it('jump() clampe aux bornes [0, flat.length-1]', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.jump(-5);
    expect(instance.pos).toBe(0);
    instance.jump(999);
    expect(instance.pos).toBe(2);
  });
});

describe('render — contenu, progression, navigation', () => {
  it('affiche la progression et le compteur X / N', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(document.querySelector('.ptuto-count')?.textContent).toBe('1 / 3');
    expect((document.querySelector('.ptuto-progress > i') as HTMLElement).style.width).toBe(
      '33%',
    );
    instance.jump(2);
    expect(document.querySelector('.ptuto-count')?.textContent).toBe('3 / 3');
    expect((document.querySelector('.ptuto-progress > i') as HTMLElement).style.width).toBe(
      '100%',
    );
  });

  it('désactive "Précédent" au premier step, libellé "Terminer" au dernier', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(document.querySelector<HTMLButtonElement>('.ptuto-prev')?.disabled).toBe(true);
    expect(document.querySelector('.ptuto-primary')?.textContent).toContain('Suivant');

    instance.jump(2);
    expect(document.querySelector<HTMLButtonElement>('.ptuto-prev')?.disabled).toBe(false);
    expect(document.querySelector('.ptuto-primary')?.textContent).toContain('Terminer');
  });

  it('rend le corps en mini-markdown **gras** échappé', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(document.querySelector('.ptuto-step-body')?.innerHTML).toBe(
      'Corps <strong>gras</strong> de 1.1',
    );
  });

  it('échappe le HTML dans le titre et le corps', async () => {
    const data = makeData();
    data.chapters[0]!.steps[0]!.title = '<img src=x>';
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig({ data }))!;
    instance.open();
    expect(document.querySelector('.ptuto-step-title')?.innerHTML).toBe('&lt;img src=x&gt;');
  });

  it('affiche le résumé de chapitre seulement s’il est non vide', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(document.querySelector('.ptuto-chap-summary')?.textContent).toBe('Résumé du chapitre un');
    instance.jump(2); // chapitre 2, summary: ''
    expect(document.querySelector('.ptuto-chap-summary')).toBeNull();
  });

  it('affiche l’encart tip seulement si step.tip est renseigné', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(document.querySelector('.ptuto-tip')).toBeNull(); // step 1.1 : tip null
    instance.go(1);
    expect(document.querySelector('.ptuto-tip p')?.innerHTML).toBe('Astuce <strong>soulignée</strong>');
  });

  it('affiche le bouton spotlight seulement si le sélecteur cible un élément présent', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(document.querySelector('.ptuto-spotbtn')).toBeNull(); // step 1.1: selector null

    instance.go(1); // step 1.2: selector '#spot-target', absent du DOM
    expect(document.querySelector('.ptuto-spotbtn')).toBeNull();

    document.body.insertAdjacentHTML('beforeend', '<div id="spot-target"></div>');
    instance.jump(1); // force un nouveau rendu maintenant que la cible existe
    expect(document.querySelector('.ptuto-spotbtn')).not.toBeNull();
  });

  it('marque un step comme "vu" dès son rendu et persiste viewed/pos', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    expect(instance.viewed.has('c1:0')).toBe(true);
    expect(JSON.parse(localStorage.getItem('ptuto_test_seen') || '[]')).toEqual(['c1:0']);
    expect(localStorage.getItem('ptuto_test_pos')).toBe('0');
  });
});

describe('sommaire (TOC)', () => {
  it('construit un item par chapitre avec icône, titre et compteur de steps', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    const items = document.querySelectorAll('.ptuto-toc-item');
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.ptuto-toc-title')?.textContent).toBe('Chapitre un');
    expect(items[0]?.querySelector('.ptuto-toc-meta')?.textContent).toBe('2');
    expect(items[1]?.querySelector('.ptuto-toc-meta')?.textContent).toBe('1');
  });

  it('le chapitre du step courant porte la classe ptuto-active', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    const items = document.querySelectorAll('.ptuto-toc-item');
    expect(items[0]?.classList.contains('ptuto-active')).toBe(true);
    expect(items[1]?.classList.contains('ptuto-active')).toBe(false);

    instance.jump(2);
    expect(document.querySelectorAll('.ptuto-toc-item')[0]?.classList.contains('ptuto-active')).toBe(
      false,
    );
    expect(document.querySelectorAll('.ptuto-toc-item')[1]?.classList.contains('ptuto-active')).toBe(
      true,
    );
  });

  it('affiche une coche quand tous les steps d’un chapitre ont été vus', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open(); // vu : c1:0
    instance.go(1); // vu : c1:1 -> chapitre 1 complet
    const metaC1 = document.querySelectorAll('.ptuto-toc-item')[0]?.querySelector('.ptuto-toc-meta');
    expect(metaC1?.querySelector('.ptuto-done')).not.toBeNull();
  });

  it('cliquer un item du TOC saute au premier step du chapitre et ferme le tiroir', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.openToc();
    const items = document.querySelectorAll<HTMLButtonElement>('.ptuto-toc-item');
    items[1]?.click();
    expect(instance.pos).toBe(2);
    expect(document.querySelector('.ptuto-panel')?.classList.contains('toc-open')).toBe(false);
  });

  it('openToc()/closeToc() bascule la classe toc-open sur le panneau', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.openToc();
    expect(document.querySelector('.ptuto-panel')?.classList.contains('toc-open')).toBe(true);
    instance.closeToc();
    expect(document.querySelector('.ptuto-panel')?.classList.contains('toc-open')).toBe(false);
  });
});

describe('recherche', () => {
  it('filtre par titre/corps/terms/chapitre, insensible à la casse', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;

    input.value = 'ALPHA'; // terms de step 1.1
    input.dispatchEvent(new Event('input', { bubbles: true }));
    let results = document.querySelectorAll('.ptuto-result');
    expect(results).toHaveLength(1);
    expect(results[0]?.textContent).toContain('Étape 1.1');

    input.value = 'chapitre deux';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    results = document.querySelectorAll('.ptuto-result');
    expect(results).toHaveLength(1);
    expect(results[0]?.textContent).toContain('Étape 2.1');
  });

  it('affiche un message vide sans résultat', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    input.value = 'zzz-introuvable';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.ptuto-empty')?.textContent).toBe(
      'Aucun résultat pour « zzz-introuvable ».',
    );
  });

  it('vider la recherche restaure le rendu du step courant', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelector('.ptuto-results')).toBeNull();
    expect(document.querySelector('.ptuto-step-title')).not.toBeNull();
  });

  it('cliquer un résultat saute au step correspondant et vide la recherche', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    input.value = 'gamma'; // terms de step 2.1 (gi=2)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.ptuto-result')?.click();
    expect(instance.pos).toBe(2);
    expect(input.value).toBe('');
  });

  it('bascule la classe has-text selon le contenu du champ', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    const wrap = document.querySelector('.ptuto-search')!;
    input.value = 'a';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(wrap.classList.contains('has-text')).toBe(true);
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(wrap.classList.contains('has-text')).toBe(false);
  });
});

describe('clavier', () => {
  it('ArrowRight/ArrowLeft naviguent, Home/End sautent aux bornes', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(instance.pos).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(instance.pos).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(instance.pos).toBe(2);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(instance.pos).toBe(0);
  });

  it("'/' donne le focus au champ de recherche", async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    expect(document.activeElement).toBe(document.querySelector('.ptuto-search input'));
  });

  it("pendant la frappe dans la recherche, les flèches ne naviguent pas (garde 'typing')", async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    input.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(instance.pos).toBe(0);
  });

  it('Escape ferme le tutoriel hors recherche', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ptuto-overlay')?.classList.contains('ptuto-show')).toBe(false);
  });

  it('1er Escape vide la recherche en cours, 2e Escape ferme', async () => {
    const PocheTuto = await freshPocheTuto();
    PocheTuto.mount(baseConfig())!.open();
    const input = document.querySelector<HTMLInputElement>('.ptuto-search input')!;
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.value).toBe('');
    expect(document.querySelector('.ptuto-overlay')?.classList.contains('ptuto-show')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ptuto-overlay')?.classList.contains('ptuto-show')).toBe(false);
  });

  it('Escape ferme le tiroir du sommaire s’il est ouvert, sans fermer le tutoriel', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.openToc();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.ptuto-panel')?.classList.contains('toc-open')).toBe(false);
    expect(document.querySelector('.ptuto-overlay')?.classList.contains('ptuto-show')).toBe(true);
  });

  it('Tab sans élément focusable visible ramène le focus sur le panneau (jsdom : offsetParent toujours null)', async () => {
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    const panel = document.querySelector<HTMLElement>('.ptuto-panel')!;
    const focusSpy = vi.spyOn(panel, 'focus');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    document.dispatchEvent(event);
    expect(preventSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
  });
});

describe('spotlight (startSpot/endSpot)', () => {
  it("sous jsdom (cible non visible : rect nulle), le clic sur le bouton spotlight affiche une note et n'active pas le mode spot", async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="spot-target"></div>');
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.go(1); // step 1.2, cible #spot-target présente mais non "visible" sous jsdom
    document.querySelector<HTMLButtonElement>('.ptuto-spotbtn')?.click();
    expect(document.querySelector('.ptuto-note')?.textContent).toBe(
      "Cet élément n'est pas visible actuellement — ouvrez d'abord le panneau ou le mode concerné, puis réessayez.",
    );
    expect(document.querySelector('.ptuto-spot-scrim')).toBeNull();
    expect(document.querySelector('.ptuto-spot-target')).toBeNull();
  });

  it('affiche une cible "visible" (mock layout) : ajoute ptuto-spot-target, scrim et callout ; masque l’overlay', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="spot-target"></div>');
    const target = document.getElementById('spot-target')!;
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      width: 40,
      height: 20,
      top: 10,
      left: 10,
      bottom: 30,
      right: 50,
      x: 10,
      y: 10,
      toJSON() {
        return {};
      },
    });
    Object.defineProperty(target, 'offsetParent', { value: document.body, configurable: true });

    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.go(1);
    document.querySelector<HTMLButtonElement>('.ptuto-spotbtn')?.click();

    expect(target.classList.contains('ptuto-spot-target')).toBe(true);
    expect(document.querySelector('.ptuto-spot-scrim')).not.toBeNull();
    expect(document.querySelector('.ptuto-spot-callout')).not.toBeNull();
    expect((document.querySelector('.ptuto-overlay') as HTMLElement).style.display).toBe('none');

    // "Reprendre le tutoriel" referme le spot et réaffiche l'overlay
    document.querySelector<HTMLButtonElement>('.ptuto-spot-callout button')?.click();
    expect(target.classList.contains('ptuto-spot-target')).toBe(false);
    expect(document.querySelector('.ptuto-spot-scrim')).toBeNull();
    expect(document.querySelector('.ptuto-spot-callout')).toBeNull();
    expect((document.querySelector('.ptuto-overlay') as HTMLElement).style.display).toBe('flex');
    expect(document.querySelector('.ptuto-overlay')?.classList.contains('ptuto-show')).toBe(true);
  });
});

describe('intégration avec les jeux de données réels (P1.A4)', () => {
  it('monte les données OI (58 steps attendus, cf. docs/SPEC-CONTRATS.md §1.2 ; +1 étape panneau Calques)', async () => {
    const { oiTutoData } = await import('@oi/tuto-data');
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount({ appId: 'oi', appName: 'OI - ADI', data: oiTutoData })!;
    expect(instance.chapters).toHaveLength(8);
    expect(instance.flat).toHaveLength(58);
    instance.open();
    expect(document.querySelector('.ptuto-step-title')?.textContent).toBeTruthy();
  });

  it('monte les données PC-Tac (61 steps — chapitres Tableau de bord supprimés, Goal.md §8 ; +2 étapes couches IGN ; +1 étape panneau Calques)', async () => {
    const { pctacTutoData } = await import('@pctac/tuto-data');
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount({
      appId: 'pctac',
      appName: 'PC-Tac',
      data: pctacTutoData,
    })!;
    expect(instance.chapters).toHaveLength(7);
    expect(instance.flat).toHaveLength(61);
    instance.open();
    expect(document.querySelector('.ptuto-step-title')?.textContent).toBeTruthy();
  });
});

describe('showNote', () => {
  it('affiche le message puis le retire après ~5.2s, sans doublon si rappelé entre-temps', async () => {
    vi.useFakeTimers();
    const PocheTuto = await freshPocheTuto();
    const instance = PocheTuto.mount(baseConfig())!;
    instance.open();
    instance.showNote('Premier message');
    expect(document.querySelectorAll('.ptuto-note')).toHaveLength(1);
    expect(document.querySelector('.ptuto-note')?.textContent).toBe('Premier message');

    instance.showNote('Second message'); // remplace, ne s'empile pas
    expect(document.querySelectorAll('.ptuto-note')).toHaveLength(1);
    expect(document.querySelector('.ptuto-note')?.textContent).toBe('Second message');

    vi.advanceTimersByTime(5200);
    expect(document.querySelector('.ptuto-note')).toBeNull();
  });
});
