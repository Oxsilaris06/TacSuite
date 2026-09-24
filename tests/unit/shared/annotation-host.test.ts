/**
 * annotation-host.test.ts — Le moteur d'annotation (`@oi/dessin.js`) est
 * partagé avec le PC-Tac (décision 25). Il ne doit pas charger l'OI : le
 * Store de `@oi/init.js` s'enregistre dans `tactical_oi_data`, et le PC-Tac
 * (même origine) écraserait l'OI en cours de rédaction.
 */
import { describe, expect, it } from 'vitest';

describe('moteur d’annotation sans l’OI', () => {
  it('importer le moteur ne charge ni le Store ni l’enregistrement de l’OI', async () => {
    localStorage.clear();
    await import('@oi/dessin.js');
    const w = window as unknown as { Store?: unknown; saveToStorage?: unknown; dbManager?: unknown };
    expect(w.Store).toBeUndefined();
    expect(w.saveToStorage).toBeUndefined();
    expect(w.dbManager).toBeUndefined();
    expect(localStorage.getItem('tactical_oi_data')).toBeNull();
  });

  it('les annotations passent par l’hôte déclaré', async () => {
    const mod = await import('@shared/annotation-host.js');
    const saved: string[] = [];
    mod.setAnnotationHost({
      annotations: [], objectUrlsCache: {},
      async getImage() { return null; },
      save() { saved.push('save'); },
      syncDom() {},
    });
    expect(mod.annotationHost.annotations).toEqual([]);
    mod.annotationHost.save();
    expect(saved).toEqual(['save']);
  });
});
