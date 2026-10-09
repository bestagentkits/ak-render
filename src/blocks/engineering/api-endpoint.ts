/**
 * Api-endpoint block: one HTTP operation with its parameters, request body and
 * responses.
 *
 * The method is a badge, the path highlights its `{param}` segments and has a
 * Copy button, the parameters are a table with row headers, and bodies use the
 * core code block markup.
 */

import { type DiagnosticBag, pathKey } from '../../diagnostics.js';
import type { IrNode } from '../../ir.js';
import { isPlainObject } from '../../json.js';
import type { BlockModule } from '../../registry/block-module.js';
import {
  anchorProps,
  bool,
  define,
  enumStr,
  LANGUAGE_DESCRIPTION,
  list,
  num,
  obj,
  str as strProp,
  txt,
} from '../../registry/define-helpers.js';
import {
  element,
  nodeAttributes,
  objectListProp,
  str,
  stringProp,
} from '../../render/block-helpers.js';
import { escapeInlineText, escapeText, renderAttributes } from '../../render/escape.js';
import { codePanel, copyButton, partId } from './engineering-helpers.js';

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const METHOD_TONES: Readonly<Record<string, string>> = {
  GET: 'info',
  POST: 'success',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'danger',
};

/** `{name}` segments of a path template. */
const PATH_PARAM = /\{([^{}/]+)\}/gu;

function statusTone(status: number): string {
  if (status >= 500) return 'danger';
  if (status >= 400) return 'warning';
  if (status >= 300) return 'info';
  if (status >= 200) return 'success';
  return 'neutral';
}

function pathMarkup(path: string): string {
  let output = '';
  let last = 0;
  for (const match of path.matchAll(PATH_PARAM)) {
    output += escapeText(path.slice(last, match.index));
    output += `<span class="ak-api-param">${escapeText(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return output + escapeText(path.slice(last));
}

function paramsTable(node: IrNode): string {
  const params = objectListProp(node, 'params');
  if (params.length === 0) return '';
  const rows = params
    .map((param) => {
      const required =
        param.required === true ? ' <span class="ak-api-required">required</span>' : '';
      return `<tr><th scope="row"><code>${escapeText(str(param.name))}</code>${required}</th><td>${escapeText(
        str(param.in),
      )}</td><td><code>${escapeText(str(param.type))}</code></td><td>${escapeInlineText(
        str(param.description),
      )}</td></tr>`;
    })
    .join('');
  return `<h3 class="ak-api-heading">Parameters</h3><div class="ak-table-wrap"><table><caption class="ak-sr">Parameters</caption><thead><tr><th scope="col">Name</th><th scope="col">In</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function requestMarkup(node: IrNode): string {
  const request = node.props.request;
  if (!isPlainObject(request) || typeof request.code !== 'string') return '';
  const language = str(request.language, 'json');
  return `<h3 class="ak-api-heading">Request body</h3>${codePanel(partId(node, 'request'), 'Request', language, request.code)}`;
}

function responsesMarkup(node: IrNode): string {
  const responses = objectListProp(node, 'responses');
  if (responses.length === 0) return '';
  const items = responses
    .map((response, index) => {
      const status = typeof response.status === 'number' ? response.status : 0;
      const code =
        typeof response.code === 'string'
          ? codePanel(
              partId(node, `response-${index}`),
              `${status} response`,
              str(response.language, 'json'),
              response.code,
            )
          : '';
      return `<li class="ak-api-response"><p class="ak-api-response-head"><span class="ak-badge" data-tone="${statusTone(
        status,
      )}">${status}</span><span>${escapeInlineText(str(response.description))}</span></p>${code}</li>`;
    })
    .join('');
  return `<h3 class="ak-api-heading">Responses</h3><ul class="ak-api-responses">${items}</ul>`;
}

function renderApiEndpoint(node: IrNode): string {
  const method = stringProp(node, 'method', 'GET');
  const path = stringProp(node, 'path');
  const summary = stringProp(node, 'summary');
  const pathTarget = partId(node, 'path');
  const head = `<div class="ak-api-head"><h2 class="ak-api-title"><span${renderAttributes({
    class: 'ak-api-method',
    'data-tone': METHOD_TONES[method] ?? 'neutral',
  })}>${escapeText(method)}</span> <code${renderAttributes({
    class: 'ak-api-path',
    'data-ak-id': pathTarget,
  })}>${pathMarkup(path)}</code></h2>${copyButton(pathTarget, `Copy path ${path}`)}</div>`;
  return element(
    'section',
    nodeAttributes(node, { class: 'ak-block ak-api' }),
    [
      head,
      summary === '' ? '' : `<p class="ak-api-summary">${escapeInlineText(summary)}</p>`,
      paramsTable(node),
      requestMarkup(node),
      responsesMarkup(node),
    ].join(''),
  );
}

/** Warn when the path template and the `in: path` parameters disagree. */
function checkPathParams(node: IrNode, bag: DiagnosticBag): void {
  const template = [...stringProp(node, 'path').matchAll(PATH_PARAM)].map(
    (match) => match[1] ?? '',
  );
  const declared = objectListProp(node, 'params')
    .filter((param) => param.in === 'path')
    .map((param) => str(param.name));
  for (const name of template.filter((name) => !declared.includes(name))) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(node.path, 'path'),
      message: `path segment "{${name}}" has no matching "in: path" parameter`,
      nodeId: node.id,
    });
  }
  for (const name of declared.filter((name) => !template.includes(name))) {
    bag.add({
      code: 'SPEC_VALIDATION_ERROR',
      severity: 'warning',
      path: pathKey(node.path, 'params'),
      message: `path parameter "${name}" does not appear in the path`,
      details: { allowed: template },
      nodeId: node.id,
    });
  }
}

const CODE = txt({ maxLength: 8_000, description: 'Emitted verbatim.' });
const LANGUAGE = strProp({ maxLength: 20, default: 'json', description: LANGUAGE_DESCRIPTION });

export const apiEndpointBlock: BlockModule = {
  definition: define({
    type: 'api-endpoint',
    kind: 'semantic',
    category: 'engineering',
    tags: ['api', 'http', 'rest', 'reference'],
    useCases: ['api reference', 'endpoint change review', 'integration guide'],
    purpose:
      'API reference for one HTTP operation: method, path, parameters, request and responses.',
    summary:
      'API endpoint: method and path with copy, a parameters table, a request body and status responses.',
    props: {
      method: enumStr(HTTP_METHODS, { required: true }),
      path: strProp({
        required: true,
        maxLength: 300,
        description: 'Path template; {name} marks a parameter.',
      }),
      summary: txt({ maxLength: 600 }),
      params: list(
        obj({
          name: strProp({ required: true, maxLength: 80 }),
          in: enumStr(['path', 'query', 'header'], { required: true }),
          type: strProp({ required: true, maxLength: 40 }),
          required: bool(),
          description: txt({ maxLength: 300 }),
        }),
        { maxItems: 20 },
      ),
      request: obj({ language: LANGUAGE, code: { ...CODE, required: true } }),
      responses: list(
        obj({
          status: num({ required: true, integer: true, min: 100, max: 599 }),
          description: strProp({ required: true, maxLength: 200 }),
          language: LANGUAGE,
          code: CODE,
        }),
        { maxItems: 8 },
      ),
      ...anchorProps,
    },
    runtimeFeatures: ['api-endpoint', 'copy'],
    sizing: {
      sizes: ['medium', 'large'],
      default: 'large',
      responsive:
        'The path wraps at any character; the parameters table scrolls inside its frame on phones.',
    },
    a11y: 'The method and path form the heading; the parameters table has column and row headers; status codes are text.',
  }),
  render: renderApiEndpoint,
  check(node, { bag }) {
    checkPathParams(node, bag);
  },
};
