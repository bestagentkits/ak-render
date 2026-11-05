/** 3D blocks: declarative Three.js scenes sharing one runtime, emitted only on pages that use them. */

import type { BlockGroup } from '../../registry/block-module.js';
import { bars3dBlock } from './bars-3d.js';
import { globe3dBlock } from './globe-3d.js';
import { GLOBE_CSS } from './globe-styles.js';
import { model3dBlock } from './model-3d.js';
import { morph3dBlock } from './morph-3d.js';
import { MORPH_CSS } from './morph-styles.js';
import { network3dBlock } from './network-3d.js';
import { NETWORK_CSS } from './network-styles.js';
import { particles3dBlock } from './particles-3d.js';
import { PARTICLES_CSS } from './particles-styles.js';
import { product3dBlock } from './product-3d.js';
import { PRODUCT_CSS } from './product-styles.js';
import { scatter3dBlock } from './scatter-3d.js';
import { SCATTER_CSS } from './scatter-styles.js';
import { scene3dBlock } from './scene-3d.js';
import { shader3dBlock } from './shader-3d.js';
import { SHADER_CSS } from './shader-styles.js';
import { text3dBlock } from './text-3d.js';
import { TEXT_CSS } from './text-styles.js';
import { THREE_RUNTIME } from './three-runtime.generated.js';
import { THREE_CSS } from './three-styles.js';

/**
 * Hands the bundled runtime the page's own helpers, and chains it onto
 * `syncBindings` so a state change from any control reaches every scene.
 */
const THREE_BOOT = `
function wireThree() {
  if (typeof __akThree === 'undefined') return;
  var baseSync = syncBindings;
  syncBindings = function () {
    baseSync();
    if (window.akRender3d) window.akRender3d.sync();
  };
  __akThree.boot({ motionAllowed: motionAllowed, fire: fire, setPath: setPath, readPath: readPath });
}`;

export const THREE_GROUP: BlockGroup = {
  name: 'three',
  blocks: [
    scene3dBlock,
    model3dBlock,
    network3dBlock,
    scatter3dBlock,
    bars3dBlock,
    particles3dBlock,
    shader3dBlock,
    text3dBlock,
    product3dBlock,
    globe3dBlock,
    morph3dBlock,
  ],
  features: [
    {
      name: 'three',
      marker: '.ak-3d{',
      css:
        THREE_CSS +
        NETWORK_CSS +
        SCATTER_CSS +
        PARTICLES_CSS +
        SHADER_CSS +
        PRODUCT_CSS +
        TEXT_CSS +
        GLOBE_CSS +
        MORPH_CSS,
      script: { code: `${THREE_RUNTIME}\n${THREE_BOOT}`, boot: 'wireThree();' },
    },
  ],
};
