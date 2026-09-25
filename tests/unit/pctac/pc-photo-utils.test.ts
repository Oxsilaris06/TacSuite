/**
 * pc-photo-utils.test.ts — Photos HEIC et GPS (B8, décision 34).
 *
 * jsdom n'implémente ni canvas ni décodage d'image : on stubbe `Image`,
 * `getContext`/`toDataURL`. Le convertisseur `heic-to` et `exifr` sont mockés
 * (chargés à la demande par `Utils`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const heicToMock = vi.hoisted(() => vi.fn());
const gpsMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock('heic-to', () => ({ heicTo: heicToMock }));
vi.mock('exifr', () => ({ gps: gpsMock }));
vi.mock('@shared/feedback.js', () => ({ confirmDialog: confirmMock }));

import { Utils } from '../../../src/apps/pctac/utils.js';

let behavior: 'ok' | 'fail' | 'fail-then-ok' = 'ok';
let attempts = 0;

class FakeImage {
  width = 10;
  height = 10;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener(): void { /* URL object revoke : sans effet ici */ }
  set src(_value: string) {
    attempts += 1;
    const fail = behavior === 'fail' || (behavior === 'fail-then-ok' && attempts === 1);
    queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
  }
}

beforeEach(() => {
  behavior = 'ok';
  attempts = 0;
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: () => {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,OUT');
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:fake';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  heicToMock.mockReset();
  gpsMock.mockReset();
  confirmMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Utils.compressImage — HEIC/HEIF (décision 34)', () => {
  it('type MIME HEIC : décodage natif d\'abord (Safari), sans convertisseur', async () => {
    const file = new File(['x'], 'photo.bin', { type: 'image/heic' });
    const out = await Utils.compressImage(file);
    expect(out).toBe('data:image/jpeg;base64,OUT');
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it('extension .heic avec type vide : converti quand le natif échoue', async () => {
    behavior = 'fail-then-ok';
    heicToMock.mockResolvedValueOnce(new Blob(['j'], { type: 'image/jpeg' }));
    const file = new File(['x'], 'photo.heic', { type: '' });
    const out = await Utils.compressImage(file);
    expect(out).toBe('data:image/jpeg;base64,OUT');
    expect(heicToMock).toHaveBeenCalledTimes(1);
    expect(heicToMock.mock.calls[0]?.[0]).toMatchObject({ type: 'image/jpeg' });
  });

  it('JPEG ordinaire : jamais de convertisseur', async () => {
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await Utils.compressImage(file);
    expect(heicToMock).not.toHaveBeenCalled();
  });

  it('natif et convertisseur en échec : erreur claire, rien d\'enregistré', async () => {
    behavior = 'fail';
    heicToMock.mockRejectedValueOnce(new Error('offline'));
    const file = new File(['x'], 'photo.heic', { type: '' });
    await expect(Utils.compressImage(file)).rejects.toThrow(/HEIC illisible/);
  });
});

describe('Utils.promptGpsPoint (décision 34)', () => {
  const jpeg = (): File => new File(['x'], 'p.jpg', { type: 'image/jpeg' });

  it('position présente + « oui » : émet pctac:add-point avec la légende', async () => {
    gpsMock.mockResolvedValue({ latitude: 48.85, longitude: 2.35 });
    confirmMock.mockResolvedValue(true);
    const events: CustomEvent[] = [];
    const listener = (e: Event): void => { events.push(e as CustomEvent); };
    document.addEventListener('pctac:add-point', listener);
    await Utils.promptGpsPoint(jpeg(), 'Légende photo');
    document.removeEventListener('pctac:add-point', listener);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toEqual({ lat: 48.85, lon: 2.35, label: 'Légende photo' });
  });

  it('position présente + « non » : aucun événement', async () => {
    gpsMock.mockResolvedValue({ latitude: 1, longitude: 2 });
    confirmMock.mockResolvedValue(false);
    const listener = vi.fn();
    document.addEventListener('pctac:add-point', listener);
    await Utils.promptGpsPoint(jpeg(), 'x');
    document.removeEventListener('pctac:add-point', listener);
    expect(listener).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('sans GPS : aucune question, aucun événement', async () => {
    gpsMock.mockResolvedValue(null);
    const listener = vi.fn();
    document.addEventListener('pctac:add-point', listener);
    await Utils.promptGpsPoint(jpeg(), 'x');
    document.removeEventListener('pctac:add-point', listener);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('exifr qui jette : silencieux, aucune question', async () => {
    gpsMock.mockRejectedValue(new Error('bad exif'));
    await expect(Utils.promptGpsPoint(jpeg(), 'x')).resolves.toBeUndefined();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
