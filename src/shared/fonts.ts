// Polices auto-hebergees (zero CDN a l'execution — plan TacSuite §2).
// Les originaux (pctac2.html:33-41, 4.html:33-39) chargeaient deux feuilles
// Google Fonts au <head> : Material Symbols Outlined (icones) et le trio
// Oswald / Inter / JetBrains Mono (systeme typographique « OLED Command »).
// Ici, memes familles et memes graisses, servies depuis node_modules via des
// paquets npm epingles et bundlees par Vite (voir package.json).
//
// Importe une fois depuis un module partage, charge par
// src/apps/pctac/main.ts ET src/apps/oi/main.ts.

// Material Symbols Outlined — police variable (axe wght 100..700, FILL
// integre au glyphe variable). Couvre a la fois la plage pctac
// (opsz,wght,FILL,GRAD@24,400,0..1,0) et la valeur fixe utilisee par oi
// (…@24,400,0,0) : les deux applications restent a FILL=0 par defaut, seule
// pctac se reserve la possibilite de varier l'axe plus tard.
import 'material-symbols/outlined.css';

// Oswald (titres) — graisses 500/600/700, seules utilisees par les deux apps.
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';

// Inter (UI / corps) — graisses 400/500/600/700.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

// JetBrains Mono (donnees) — graisses 500/600/700.
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
