/**
 * pm-legacy.test.ts — Tests du paquet `pm-legacy` (code mort legacy.ts)
 * =====================================================================
 *
 * Spécification §9 : un seul test suffit — vérifier que les 10 méthodes
 * existent sur `LegacyMethods` et sont bien des fonctions.
 */

import { describe, it, expect } from 'vitest';
import { LegacyMethods } from '@pctac/planmap/legacy.js';

describe('LegacyMethods', () => {
	it('devrait exporter les 10 méthodes du cluster transform mort', () => {
		// Énumération exhaustive des 10 méthodes selon SPEC-PLANMAP-SPLIT §4.17
		const requiredMethods = [
			'_onShapeClick',
			'_renderFloatingToolbar',
			'_startTransform',
			'_startMoveShape',
			'_startResizeShape',
			'_endMoveShape',
			'_cancelMoveShape',
			'_teardownMove',
			'_showTransformToolbar',
			'_hideTransformToolbar',
		];

		for (const methodName of requiredMethods) {
			expect(LegacyMethods).toHaveProperty(methodName);
			expect(typeof (LegacyMethods as Record<string, unknown>)[methodName]).toBe('function');
		}
	});
});
