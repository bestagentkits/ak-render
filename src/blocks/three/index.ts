/** 3D blocks: declarative Three.js scenes sharing one runtime, emitted only on pages that use them. */

import type { BlockGroup } from '../../registry/block-module.js';
import { bars3dBlock } from './bars-3d.js';
import { network3dBlock } from './network-3d.js';
import { NETWORK_CSS } from './network-styles.js';
import { scene3dBlock } from './scene-3d.js';
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
  blocks: [scene3dBlock, network3dBlock, bars3dBlock],
  features: [
    {
      name: 'three',
      marker: '.ak-3d{',
      css: THREE_CSS + NETWORK_CSS,
      script: { code: `${THREE_RUNTIME}\n${THREE_BOOT}`, boot: 'wireThree();' },
    },
  ],
};
