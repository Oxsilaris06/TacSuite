/**
 * image-size.ts — Dimensions d'une image JPEG ou PNG lues dans son en-tête.
 * Le lecteur vit dans `@shared/image-size` (commun à l'OI et à PC-Tac) ; ce
 * module le réexporte pour les imports existants de l'OI.
 */
export { imageSizeFromDataUrl, type ImageSize } from '@shared/image-size.js';
