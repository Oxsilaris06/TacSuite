import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Roue contextuelle (radial menu) — portée depuis pctac2 (wheel.js) en script
 * global. Ouvre un menu radial à un point lng/lat ; suit la carte ; se ferme
 * sur clic extérieur / Échap / bouton central / choix d'une option.
 */
export class OIWheel {
    map: MapLibreMap | null;
    lngLat: { lng: number; lat: number } | null;
    title: string | null;
    centerIcon: string;
    options: Array<{ label: string; icon: string; action?: (wheel: OIWheel) => void; keepOpen?: boolean; bg?: string; color?: string }>;
    radius: number;
    onClose: (() => void) | null;
    element: HTMLElement | null;
    _onMove: (() => void) | null;
    _onOutsideHandler: ((ev: PointerEvent | TouchEvent) => void) | null;
    _onKey: ((ev: KeyboardEvent) => void) | null;
    _destroyed: boolean;
    _mountedAt: number;

    constructor(opts: {
        map?: MapLibreMap;
        lngLat?: { lng: number; lat: number };
        title?: string;
        centerIcon?: string;
        options?: Array<{ label: string; icon: string; action?: (wheel: OIWheel) => void; keepOpen?: boolean; bg?: string; color?: string }>;
        radius?: number;
        onClose?: () => void;
    }) {
        this.map = opts.map || null;
        this.lngLat = opts.lngLat || null;
        this.title = opts.title || null;
        this.centerIcon = opts.centerIcon || 'close';
        this.options = opts.options || [];
        this.radius = opts.radius || 80;
        this.onClose = opts.onClose || null;
        this.element = null;
        this._onMove = () => this._position();
        this._onOutsideHandler = this._onOutside.bind(this);
        this._onKey = (ev) => { if (ev.key === 'Escape') this.destroy(); };
        this._destroyed = false;
        this._mountedAt = 0;
    }

    open(): void {
        if (this.element) return;
        this.element = this._buildElement();
        const parent = this.map ? this.map.getContainer() : document.body;
        parent.appendChild(this.element);
        this._position();
        if (this.map && this._onMove) { this.map.on('move', this._onMove); this.map.on('zoom', this._onMove); }
        this._mountedAt = Date.now();
        if (this._onOutsideHandler) {
            document.addEventListener('pointerdown', this._onOutsideHandler as EventListener, { capture: true });
            document.addEventListener('touchstart', this._onOutsideHandler as EventListener, { capture: true, passive: true });
        }
        if (this._onKey) {
            document.addEventListener('keydown', this._onKey as EventListener);
        }
        requestAnimationFrame(() => { if (this.element) this.element.classList.add('open'); });
    }

    destroy(): void {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.element) { try { this.element.remove(); } catch { /* ignore */ } this.element = null; }
        if (this.map && this._onMove) {
            try { this.map.off('move', this._onMove); } catch { /* ignore */ }
            try { this.map.off('zoom', this._onMove); } catch { /* ignore */ }
        }
        if (this._onOutsideHandler) {
            document.removeEventListener('pointerdown', this._onOutsideHandler as EventListener, { capture: true });
            document.removeEventListener('touchstart', this._onOutsideHandler as EventListener, { capture: true });
        }
        if (this._onKey) {
            document.removeEventListener('keydown', this._onKey as EventListener);
        }
        if (this.onClose) { try { this.onClose(); } catch { /* ignore */ } }
    }

    _onOutside(ev: PointerEvent | TouchEvent): void {
        if (!this.element) return;
        const isTouch = ('pointerType' in ev && ev.pointerType === 'touch') || ev.type === 'touchstart';
        const minDelay = isTouch ? 300 : 120;
        if (Date.now() - this._mountedAt < minDelay) return;
        const target = ev.target instanceof Element ? ev.target : null;
        if (target && (target.closest('.plan-pin') || target.closest('.oi-carto-pin'))) return;
        if (!this.element.contains(target)) this.destroy();
    }

    _position(): void {
        if (!this.element || !this.map) return;
        if (!this.lngLat) {
            const r = this.map.getContainer().getBoundingClientRect();
            this.element.style.left = `${r.width / 2}px`;
            this.element.style.top = `${r.height / 2}px`;
            return;
        }
        const p = this.map.project(this.lngLat);
        this.element.style.left = `${p.x}px`;
        this.element.style.top = `${p.y}px`;
    }

    _buildElement(): HTMLElement {
        const n = this.options.length;
        const vw = (typeof window !== 'undefined' ? window.innerWidth : 1024);
        const radius = vw < 480 ? Math.min(this.radius, 88) : Math.max(this.radius, 98);
        const arcSpan = n <= 2 ? Math.PI : 2 * Math.PI;
        const arcStart = n <= 2 ? -Math.PI / 2 - arcSpan / 2 : -Math.PI / 2;
        const btnSize = vw < 480 ? 52 : 58;
        const wrap = document.createElement('div');
        wrap.className = 'oi-wheel';
        wrap.style.cssText = `position:absolute; width:${radius * 2 + btnSize + 36}px; height:${radius * 2 + btnSize + 36}px;
            transform:translate(-50%,-50%) scale(0.85); opacity:0;
            transition:transform 160ms cubic-bezier(.34,1.56,.64,1), opacity 140ms ease-out; z-index:60; pointer-events:none;`;
        const bg = document.createElement('div');
        bg.style.cssText = `position:absolute; inset:0; border-radius:50%;
            background:radial-gradient(circle at center, rgba(20,24,32,0.55) 0%, rgba(20,24,32,0.10) 70%, transparent 100%); pointer-events:none;`;
        wrap.appendChild(bg);
        const center = document.createElement('button');
        center.type = 'button';
        center.className = 'oi-wheel-center';
        center.title = 'Fermer';
        center.style.cssText = `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
            width:54px; height:54px; border-radius:50%; background:rgba(20,24,32,0.95);
            border:2px solid rgba(255,255,255,0.35); color:#fff; cursor:pointer;
            display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px;
            pointer-events:auto; box-shadow:0 4px 16px rgba(0,0,0,0.55); touch-action:none; font-family:var(--font-ui,sans-serif);`;
        center.innerHTML = `<span class="material-symbols-outlined" style="font-size:22px; line-height:1;">${this.centerIcon}</span>
            <span style="font-size:9px; font-weight:700; letter-spacing:0.5px; opacity:0.85;">FERMER</span>`;
        center.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        center.onclick = (ev) => { ev.stopPropagation(); this.destroy(); };
        wrap.appendChild(center);
        if (this.title) {
            const t = document.createElement('div');
            t.style.cssText = `position:absolute; left:50%; bottom:-28px; transform:translateX(-50%);
                background:rgba(20,24,32,0.92); color:#fff; padding:3px 10px; border-radius:12px;
                font-family:var(--font-ui,sans-serif); font-size:0.78em; font-weight:600; white-space:nowrap;
                pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,0.4);`;
            t.textContent = this.title;
            wrap.appendChild(t);
        }
        this.options.forEach((opt, i) => {
            const angle = arcStart + (n === 1 ? 0 : (i / Math.max(1, n - (arcSpan >= 2 * Math.PI ? 0 : 1))) * arcSpan);
            const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
            const b = document.createElement('button');
            b.type = 'button';
            b.title = opt.label;
            const bg2 = opt.bg || 'rgba(20,24,32,0.92)';
            const col = opt.color || '#fff';
            const border = opt.color || (opt.bg ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)');
            b.style.cssText = `position:absolute; left:50%; top:50%;
                transform:translate(calc(-50% + ${x}px), calc(-50% + ${y}px));
                width:${btnSize}px; height:${btnSize}px; border-radius:50%; background:${bg2};
                border:2px solid ${border}; color:${col}; cursor:pointer; display:flex; align-items:center; justify-content:center;
                pointer-events:auto; box-shadow:0 3px 12px rgba(0,0,0,0.55); touch-action:none; padding:0;`;
            b.innerHTML = `<span class="material-symbols-outlined" style="font-size:${btnSize >= 56 ? 26 : 22}px; line-height:1;">${opt.icon}</span>`;
            const labelBelow = y > -radius * 0.3;
            const labelOffset = labelBelow ? (btnSize / 2 + 6) : -(btnSize / 2 + 16);
            const tip = document.createElement('span');
            tip.textContent = opt.label;
            tip.style.cssText = `position:absolute; top:calc(50% + ${labelOffset}px); left:50%; transform:translateX(-50%);
                background:rgba(0,0,0,0.85); color:#fff; font-family:var(--font-ui,sans-serif); font-size:0.7em; font-weight:700;
                letter-spacing:0.3px; padding:2px 7px; border-radius:8px; white-space:nowrap; pointer-events:none;
                box-shadow:0 1px 4px rgba(0,0,0,0.5); max-width:110px; overflow:hidden; text-overflow:ellipsis;`;
            b.appendChild(tip);
            b.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            b.onclick = (ev) => {
                ev.stopPropagation();
                if (opt.action) { try { opt.action(this); } catch (e) { console.error('[OIWheel] action:', e); } }
                if (!opt.keepOpen) this.destroy();
            };
            wrap.appendChild(b);
        });
        return wrap;
    }
}

// Injection CSS du style #oi-wheel-style
if (typeof document !== 'undefined' && !document.getElementById('oi-wheel-style')) {
    const s = document.createElement('style');
    s.id = 'oi-wheel-style';
    s.textContent = `
        .oi-wheel.open { opacity:1 !important; transform:translate(-50%,-50%) scale(1) !important; }
        .oi-wheel button:active { filter:brightness(0.82); box-shadow:0 1px 4px rgba(0,0,0,0.75) inset, 0 1px 5px rgba(0,0,0,0.45); }
        .oi-wheel-center:active { transform:translate(-50%,-50%) scale(0.94) !important; }
        .oi-carto-inline-panel { position:absolute; z-index:62; transform:translate(-50%,-100%);
            background:rgba(20,24,32,0.97); border:1px solid rgba(255,255,255,0.18); border-radius:12px;
            padding:10px; box-shadow:0 8px 28px rgba(0,0,0,0.6); pointer-events:auto;
            font-family:var(--font-ui,sans-serif); color:#fff; max-width:min(92vw,340px); }
        .oi-carto-member-placed { opacity:0.5; filter:grayscale(0.7); }
        .oi-carto-fn-group-title { font-size:0.72em; text-transform:uppercase; letter-spacing:0.5px;
            color:var(--text-muted,#9aa4b2); margin:8px 0 4px; font-weight:700; }
    `;
    document.head.appendChild(s);
}
