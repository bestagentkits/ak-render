/**
 * Theme preview pages for the gallery.
 *
 * Compiles `fixtures/pages/theme-showcase.yaml` once per built-in preset into
 * `themes/<preset>.html`, and writes `themes/index.html`: a small viewer whose
 * dropdown swaps the framed page, so every preset can be compared on the same
 * content. Each preset page stays a standalone compiled artifact.
 *
 * The viewer is the one gallery page that is not a Page Spec, because the spec
 * deliberately has no iframe and no navigation action. It stays inside the
 * product rules anyway: no network (its CSP only allows framing local files),
 * deterministic bytes, and a plain list of links when JavaScript is off.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Preset shown when the address names none: the newest editorial preset. */
const DEFAULT_PRESET = 'crimson-press';

/**
 * Returns `[path, html]` pairs relative to the gallery root.
 * @param {{ compile: Function, builtinThemeCatalog: Function, themePresetNames: Function, pagesDir: string, version: string }} options
 */
export function buildThemePreview({
  compile,
  builtinThemeCatalog,
  themePresetNames,
  pagesDir,
  version,
}) {
  const spec = readFileSync(join(pagesDir, 'theme-showcase.yaml'), 'utf8');
  const catalog = builtinThemeCatalog().entries;
  const presets = themePresetNames().map((name) => ({
    name,
    description: catalog[name]?.description ?? '',
  }));
  const files = presets.map(({ name }) => [
    `themes/${name}.html`,
    compile(spec, { theme: name, source: 'theme-showcase.yaml' }).html,
  ]);
  files.push(['themes/index.html', viewerHtml(presets, version)]);
  return files;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function sha256(value) {
  return `'sha256-${createHash('sha256').update(value, 'utf8').digest('base64')}'`;
}

const VIEWER_CSS = `
:root{--bg:#f6f5f2;--bar:#ffffff;--ink:#17171a;--muted:#5d5d66;--line:#dedcd6;--accent:#b4232c;--focus:#1f5fbf;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--bar:#1b1b1f;--ink:#f1f0ec;--muted:#a3a2ab;--line:#2f2f35;--accent:#ef5d63;--focus:#7fb0ff}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;height:100%}
body{display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:10px 16px;background:var(--bar);border-bottom:1px solid var(--line)}
h1{margin:0;font-size:15px;font-weight:650;letter-spacing:-.01em}
h1 a{color:inherit;text-decoration:none}
h1 span{color:var(--muted);font-weight:500}
label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
select{min-height:36px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit;font-weight:600}
select:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
#desc{flex:1 1 260px;margin:0;font-size:13px;color:var(--muted)}
.open{font-size:13px;font-weight:600;color:var(--accent);white-space:nowrap}
main{flex:1;display:flex;min-height:0}
iframe{flex:1;width:100%;border:0;background:#fff}
ul{margin:0;padding:16px 16px 32px 36px;line-height:2}
ul a{color:var(--accent);font-weight:600}
`.trim();

const VIEWER_JS = `
(function(){
  var select=document.getElementById('preset'),frame=document.getElementById('frame'),open=document.getElementById('open'),desc=document.getElementById('desc');
  var fallback=document.getElementById('links');fallback.hidden=true;document.getElementById('viewer').hidden=false;
  function show(name,push){
    var option=select.querySelector('option[value="'+name+'"]');
    if(!option)return;
    select.value=name;frame.src=name+'.html';open.href=name+'.html';
    desc.textContent=option.getAttribute('data-description');
    frame.title='Theme showcase in the '+name+' preset';
    document.title=name+' · Theme preview · AK Render';
    if(push)history.replaceState(null,'','#'+name);
  }
  select.addEventListener('change',function(){show(select.value,true)});
  window.addEventListener('hashchange',function(){show(location.hash.slice(1),false)});
  show(location.hash.slice(1)||select.value,false);
})();
`.trim();

function viewerHtml(presets, version) {
  const initial = presets.find((preset) => preset.name === DEFAULT_PRESET) ?? presets[0];
  const options = presets
    .map(
      ({ name, description }) =>
        `<option value="${name}" data-description="${escapeHtml(description)}"${name === initial.name ? ' selected' : ''}>${name}</option>`,
    )
    .join('');
  const links = presets
    .map(
      ({ name, description }) =>
        `<li><a href="${name}.html">${name}</a> — ${escapeHtml(description)}</li>`,
    )
    .join('');
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "connect-src 'none'",
    "frame-src file: 'self'",
    `style-src ${sha256(VIEWER_CSS)}`,
    `script-src ${sha256(VIEWER_JS)}`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" />
<meta name="color-scheme" content="light dark" />
<title>Theme preview · AK Render</title>
<meta name="description" content="Compare every built-in AK Render theme preset on the same compiled page." />
<meta property="og:title" content="Theme preview · AK Render" />
<meta property="og:description" content="Compare every built-in AK Render theme preset on the same compiled page." />
<style>${VIEWER_CSS}</style>
</head>
<body>
<header>
<h1><a href="../index.html">AK Render</a> <span>Theme preview · ${escapeHtml(version)}</span></h1>
<label for="preset">Theme <select id="preset" name="preset">${options}</select></label>
<p id="desc">${escapeHtml(initial.description)}</p>
<a class="open" id="open" href="${initial.name}.html">Open full page ↗</a>
</header>
<main id="viewer" hidden><iframe id="frame" title="Theme showcase in the ${initial.name} preset" src="${initial.name}.html"></iframe></main>
<ul id="links">${links}</ul>
<script>${VIEWER_JS}</script>
</body>
</html>
`;
}
