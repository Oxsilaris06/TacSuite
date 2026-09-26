/**
 * log-window.ts — HTML de la fenêtre « LOG » de l'OI (console mobile).
 * Extrait de main.ts (revue de sécurité côté client du 2026-09-26, C-2).
 */

import { esc } from '@shared/ui-platform.js';

/** Chaque ligne capturée est ÉCHAPPÉE : une chaîne non fiable journalisée (nom d'image d'une archive importée…) ne devient jamais du code. */
export function buildLogsHtml(logs: readonly string[]): string {
    return `<html><head><title>Console Logs - GStart</title><style>body { font-family: monospace; background: #000; color: #fff; padding: 20px; line-height: 1.5; } h2 { color: #3b82f6; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; } .log { color: #fff; border-bottom: 1px solid #1a1a1a; padding: 4px 0; } .warn { color: #fbbf24; border-bottom: 1px solid #1a1a1a; padding: 4px 0; } .error { color: #f87171; font-weight: bold; border-left: 3px solid red; padding: 4px 0 4px 10px; border-bottom: 1px solid #1a1a1a; } .btn-clear { background: #ef4444; color: white; border: none; padding: 5px 15px; border-radius: 4px; cursor: pointer; font-size: 14px; }</style></head><body><h2>GStart Mobile Console <button type="button" class="btn-clear" onclick="localStorage.removeItem('gstart_captured_logs'); location.reload();">Vider les logs</button></h2>${logs.map((l) => {
            const cls = l.includes('[ERROR]') ? 'error' : l.includes('[WARN]') ? 'warn' : 'log';
            return `<div class="${cls}">${esc(l)}</div>`;
        }).reverse().join('')}</body></html>`;
}
