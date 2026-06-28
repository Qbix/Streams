"use strict";

/**
 * Streams/handlers/Streams/commands/cssUpdate.js
 *
 * Q.handler for CSS-update commands on generated tools. Loaded into
 * Q.handlers.Streams.commands.cssUpdate. Registered in config as the Streams
 * plugin's example command:
 *
 *   Streams/commands/Streams/tool/cssUpdate : {
 *     handler: "Streams/commands/cssUpdate", routing: "immediate"
 *   }
 *
 * Two entry points produce the same effect:
 *   - The classifier matches a phrase ("recolor it to red and black") and
 *     dispatches here with captures.prompt + captures.elementId.
 *   - The Pipeline returns action='ephemeral', ephemeralType='Streams/tool/
 *     cssUpdate' and the orchestrator calls the same handler.
 *
 * Either way this translates the natural-language request into a Q/style stream
 * EPHEMERAL targeting the generated tool element by id. The Q/style event
 * updates scoped CSS custom properties (--AI-accent, --AI-bg, ...) without
 * re-rendering the tool; listenForStyle on each client injects a scoped <style>
 * tag replacing the previous one — idempotent. The ephemeral (not a socket
 * event) reaches every screen on the presentation stream.
 *
 * The LLM call is routed through AI_LLM, required lazily so Streams carries no
 * hard dependency on the AI plugin — if AI isn't installed the handler logs and
 * returns. Route is config-driven (default 'fast'); a small, cheap translation.
 * Structured JSON is enforced via response_format='json_schema' with a schema
 * constraining the keys to known CSS custom properties.
 *
 * @module Streams
 * @class Streams.commands.cssUpdate
 * @param {Object}   captures   { prompt, elementId }
 * @param {Object}   stream     presentation stream proxy (.ephemeral)
 * @param {Object}   state      session/presentation state
 * @param {Object}   Q          server-side Q
 * @param {Function} [callback] (err, result) called on completion
 */

var Q = require('Q');

var SYSTEM_PROMPT = 'You translate natural language CSS requests into JSON.\n' +
    'The tool has these CSS custom properties: --AI-bg, --AI-accent, --AI-accent2,\n' +
    '--AI-text, --AI-border, --AI-sq-light, --AI-sq-dark, --AI-sq-select.\n' +
    'Return ONLY a JSON object mapping property names to colour values.\n' +
    'Example: {"--AI-accent":"#ef4444","--AI-accent2":"#1a1a1a"}\n' +
    'Use any subset of the listed properties — only include the ones the user\'s\n' +
    'request actually touches. No explanation, no markdown, just the JSON.';

var RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        '--AI-bg':        { type: 'string' },
        '--AI-accent':    { type: 'string' },
        '--AI-accent2':   { type: 'string' },
        '--AI-text':      { type: 'string' },
        '--AI-border':    { type: 'string' },
        '--AI-sq-light':  { type: 'string' },
        '--AI-sq-dark':   { type: 'string' },
        '--AI-sq-select': { type: 'string' }
    },
    additionalProperties: false
};

module.exports = async function cssUpdate(captures, stream, state, Q, callback) {
    callback = callback || function () {};
    var prompt    = captures && captures.prompt;
    var elementId = captures && captures.elementId;
    if (!prompt || !elementId) return callback(null, { applied: false });

    var AI_LLM;
    try {
        AI_LLM = Q.require('AI/LLM');
    } catch (e) {
        Q.log && Q.log('Streams/cssUpdate: AI/LLM not available — skipping');
        return callback(null, { applied: false });
    }
    if (!AI_LLM || !AI_LLM.route) {
        Q.log && Q.log('Streams/cssUpdate: AI/LLM has no route()');
        return callback(null, { applied: false });
    }

    var routeName = Q.Config.get(
        ['Streams', 'commands', 'Streams', 'tool/cssUpdate', 'route'], 'fast'
    );

    var execOptions = {
        response_format: 'json_schema',
        json_schema:     RESPONSE_SCHEMA,
        max_tokens:      200,
        temperature:     0
    };

    var adapter = AI_LLM.route(routeName, execOptions);
    if (!adapter) {
        Q.log && Q.log('Streams/cssUpdate: no LLM adapter for route "' + routeName + '"');
        return callback(null, { applied: false });
    }

    var raw;
    try {
        raw = await adapter.executeModel(SYSTEM_PROMPT, { text: prompt }, execOptions);
    } catch (e) {
        Q.log && Q.log('Streams/cssUpdate: LLM error', e.message);
        return callback(e);
    }

    var text = (typeof raw === 'string') ? raw : (raw && raw.text) || '';
    if (!text) return callback(null, { applied: false });

    var vars;
    try {
        vars = JSON.parse(_stripMarkdownFences(text));
    } catch (e) {
        Q.log && Q.log('Streams/cssUpdate: parse error', e.message, 'text:', text.slice(0, 120));
        return callback(e);
    }
    if (!vars || typeof vars !== 'object' || !Object.keys(vars).length) {
        return callback(null, { applied: false });
    }

    // Q/style as a stream ephemeral (not a socket event): reaches every screen
    // on the presentation stream (shared ?f=1, audience phones, host pane).
    stream.ephemeral('Q/style', {
        elementId: elementId,
        selector:  '*',
        vars:      vars
    });

    Q.log && Q.log('Streams/cssUpdate: patched', Object.keys(vars).length, 'vars on', elementId);
    callback(null, { applied: true, vars: vars });
};

function _stripMarkdownFences(text) {
    if (!text) return '';
    return text
        .replace(/^\s*```(?:javascript|js|json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim();
}