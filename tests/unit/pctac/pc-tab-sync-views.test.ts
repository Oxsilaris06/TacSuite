/**
 * pc-tab-sync-views.test.ts — Repeint les vues sur changement distant (B6, décision 29).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    initTabSyncViews,
    resetTabSyncViewsForTests,
    routeRemoteData,
    routeRemoteImage,
    type RemoteViewActions,
} from '../../../src/apps/pctac/tab-sync-views.js';
import { ADVERSARIES_KEY, FRIENDS_KEY, HOSTAGES_KEY, PHOTOS_KEY, LOCAL_STORAGE_KEY } from '../../../src/apps/pctac/config.js';

const actions = () => ({
    log: vi.fn(),
    adversaries: vi.fn(),
    hostages: vi.fn(),
    friends: vi.fn(),
    photos: vi.fn(),
});
const asActions = (a: ReturnType<typeof actions>): RemoteViewActions => a as unknown as RemoteViewActions;

beforeEach(() => {
    resetTabSyncViewsForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('routeRemoteData', () => {
    it('route chaque clé logique vers sa vue', () => {
        const a = actions();
        routeRemoteData(LOCAL_STORAGE_KEY, true, asActions(a));
        routeRemoteData(ADVERSARIES_KEY, true, asActions(a));
        routeRemoteData(HOSTAGES_KEY, true, asActions(a));
        routeRemoteData(FRIENDS_KEY, true, asActions(a));
        routeRemoteData(PHOTOS_KEY, true, asActions(a));
        expect(a.log).toHaveBeenCalledTimes(1);
        expect(a.adversaries).toHaveBeenCalledTimes(1);
        expect(a.hostages).toHaveBeenCalledTimes(1);
        expect(a.friends).toHaveBeenCalledTimes(1);
        expect(a.photos).toHaveBeenCalledTimes(1);
    });

    it('ignore une écriture locale (remote absent) et une clé inconnue', () => {
        const a = actions();
        routeRemoteData(ADVERSARIES_KEY, false, asActions(a));
        routeRemoteData('pcTacInconnu', true, asActions(a));
        expect(a.adversaries).not.toHaveBeenCalled();
    });
});

describe('routeRemoteImage', () => {
    it('repeint photos, adversaires et otages', () => {
        const a = actions();
        routeRemoteImage('x', 'put', asActions(a));
        expect(a.photos).toHaveBeenCalledTimes(1);
        expect(a.adversaries).toHaveBeenCalledTimes(1);
        expect(a.hostages).toHaveBeenCalledTimes(1);
    });
});

describe('initTabSyncViews — écouteurs DOM', () => {
    it('repeint sur pctac:data distant seulement', () => {
        const a = actions();
        initTabSyncViews(asActions(a));
        document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: ADVERSARIES_KEY, remote: true } }));
        document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: ADVERSARIES_KEY } }));
        document.dispatchEvent(new CustomEvent('pctac:data', { detail: { key: PHOTOS_KEY, remote: true } }));
        expect(a.adversaries).toHaveBeenCalledTimes(1);
        expect(a.photos).toHaveBeenCalledTimes(1);
    });

    it('repeint sur pctac:image distant seulement', () => {
        const a = actions();
        initTabSyncViews(asActions(a));
        document.dispatchEvent(new CustomEvent('pctac:image', { detail: { id: 'x', op: 'delete', remote: true } }));
        document.dispatchEvent(new CustomEvent('pctac:image', { detail: { id: 'y', op: 'put' } }));
        expect(a.photos).toHaveBeenCalledTimes(1);
    });
});
