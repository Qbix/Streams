"use strict";

var Q = require('Q');

/**
 * Streams/classes/Streams/Commands.js
 *
 * Shared command primitives for the CommandsClassifier, command handlers, and
 * the entity (NER) pass. Plugin-agnostic — it names no plugin and no specific
 * command.
 *
 * Two responsibilities:
 *
 *  1. Streams.Commands.compile(phrase) turns a phrase string into a tester:
 *       - "next slide"            -> substring test
 *       - "/^next$/"              -> raw regex test
 *       - "go to {{query}}"       -> template with a named capture group
 *     Template placeholders use the {{double-brace}} convention and may carry a
 *     capture rule:
 *       {{query}}            -> (?<query>.+)            greedy named group
 *       {{pos:time}}         -> (?<pos>.+) then run Streams.Commands.Extract.time
 *                               over the captured span (a named post-processor)
 *       {{count:/\d+/}}      -> (?<count>\d+)           inline regex for the group
 *     compile() returns { source, regex, groups, typed, test }, where `groups`
 *     lists the capture names and `typed` lists { name, type } post-processors.
 *
 *  2. Streams.Commands.registry maps a command to { emit, captures }. Plugins
 *     populate it via Streams.Commands.register({...}) so the classifier never
 *     hardcodes display behavior (slide, zoom, scroll, gallery, ...). The
 *     classifier reads `emit` to fire an ephemeral and `captures` to scan the
 *     whole utterance for that command.
 *
 *  3. Streams.Commands.captures(tester, text) reads the named groups off a match
 *     and runs any typed post-processors. Streams.Commands.scan(spec, text) runs
 *     a { key: extractorName } map of extractors over the WHOLE utterance (for
 *     values that aren't bounded by a placeholder — a time anywhere in the
 *     sentence, a write level, an ordinal). Both return a plain captures object.
 *
 * The value extractors are HANDLERS, under Streams/handlers/Streams/commands/
 * extract/, auto-loaded by Bootstrap.loadHandlers into Q.handlers. A capture rule
 * names one ("time", "writeLevel", ...) and Streams.Commands.extractor() resolves
 * it; Streams.Commands.Extract is an ergonomic getter over that handler subtree.
 * A plugin adds an extractor by dropping a file in its handlers/ tree -- no edit
 * here. The classifier runs them, command handlers call them, and the entity pass
 * runs them over free speech to spot people/places for avatar and stream lookup.
 *
 * @module Streams
 * @class Streams.Commands
 */

function Streams_Commands() {}
var Commands = Streams_Commands;

// -- Command registry (populated by plugins) ---------------------------------
// command -> { emit: fn(captures, stream, state, Q), captures: { key: extractor } }
Commands.registry = {};

/**
 * Register command behaviour. Plugins call this at load (e.g. Media registers
 * its slide/zoom/scroll/gallery emitters), keeping the classifier generic.
 * @method register
 * @static
 * @param {Object} map  command -> { emit, captures }
 */
Commands.register = function (map) {
    if (!map) { return; }
    Object.keys(map).forEach(function (command) { Commands.registry[command] = map[command]; });
};

// -- Phrase compilation ------------------------------------------------------

/**
 * @method compile
 * @static
 * @param {String} phrase
 * @return {Object|null} { source, regex, groups, typed, test }
 */
Commands.compile = function (phrase) {
    if (typeof phrase !== 'string') { return null; }

    // /regex/ -> raw regex tester
    if (phrase.length > 1 && phrase.charAt(0) === '/' && phrase.slice(-1) === '/') {
        var raw = new RegExp(phrase.slice(1, -1), 'i');
        return { source: phrase, regex: raw, groups: [], typed: [],
                 test: function (t) { return raw.test(t); } };
    }

    // no placeholder -> substring tester
    if (phrase.indexOf('{{') === -1) {
        var sub = phrase.toLowerCase();
        return { source: phrase, regex: null, groups: [], typed: [],
                 test: function (t) { return t.indexOf(sub) !== -1; } };
    }

    // {{name}} | {{name:extractor}} | {{name:/regex/}}
    var tokenRe = /\{\{\s*(\w+)\s*(?::\s*(?:\/(.+?)\/|(\w+)))?\s*\}\}/g;
    var groups = [], typed = [], out = '', last = 0, m;
    while ((m = tokenRe.exec(phrase)) !== null) {
        out += _escapeRegex(phrase.slice(last, m.index));
        var name = m[1], pattern = m[2], extractor = m[3];
        groups.push(name);
        if (extractor) { typed.push({ name: name, type: extractor }); }
        out += '(?<' + name + '>' + (pattern || '.+') + ')';
        last = m.index + m[0].length;
    }
    out += _escapeRegex(phrase.slice(last));

    var rx;
    try {
        rx = new RegExp(out, 'i');
    } catch (e) {
        // malformed inline pattern -> fall back to a literal substring of the
        // text before the first placeholder, so a bad rule never throws at load
        var head = phrase.slice(0, phrase.indexOf('{{')).trim().toLowerCase();
        return { source: phrase, regex: null, groups: [], typed: [],
                 test: function (t) { return head ? t.indexOf(head) !== -1 : false; } };
    }
    return { source: phrase, regex: rx, groups: groups, typed: typed,
             test: function (t) { return rx.test(t); } };
};

/**
 * Read named groups off a tester match and run typed post-processors. Each
 * typed processor gets (capturedSpan, fullText) so it can use either.
 * @method captures
 * @static
 * @param {Object} tester  a compile() result
 * @param {String} text
 * @return {Object}
 */
Commands.captures = function (tester, text) {
    var caps = {};
    if (!tester || !tester.regex) { return caps; }
    var m = String(text == null ? '' : text).match(tester.regex);
    if (!m) { return caps; }

    var g = m.groups || {};
    Object.keys(g).forEach(function (k) {
        caps[k] = (g[k] == null ? '' : String(g[k])).trim();
    });
    (tester.typed || []).forEach(function (t) {
        var fn = Commands.extractor(t.type);
        if (typeof fn !== 'function') { return; }
        var v = fn(caps[t.name] != null ? caps[t.name] : text, text);
        _merge(caps, t.name, v);
    });
    return caps;
};

/**
 * Run a { key: extractorName } map over the whole utterance. Used for captures
 * that aren't bounded by a placeholder. An extractor that returns an object has
 * its keys merged; a scalar fills `key` (only if not already set).
 * @method scan
 * @static
 * @param {Object} spec   e.g. { pos: 'time' } or { writeLevel: 'writeLevel' }
 * @param {String} text
 * @param {Object} [into]
 * @return {Object}
 */
Commands.scan = function (spec, text, into) {
    into = into || {};
    if (!spec) { return into; }
    Object.keys(spec).forEach(function (key) {
        var fn = Commands.extractor(spec[key]);
        if (typeof fn !== 'function') { return; }
        var v = fn(text, text);
        if (v && typeof v === 'object') {
            Object.keys(v).forEach(function (kk) { into[kk] = v[kk]; });
        } else if (v != null && into[key] == null) {
            into[key] = v;
        }
    });
    return into;
};

function _merge(caps, name, v) {
    if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (kk) { caps[kk] = v[kk]; });
    } else {
        caps[name] = v;
    }
}

function _escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -- Extractors (resolved as handlers) ---------------------------------------
// Extractors are handler files under Streams/handlers/Streams/commands/extract/,
// auto-loaded by Bootstrap.loadHandlers into Q.handlers.Streams.commands.extract.
// A capture rule names one by its bare name ("time", "writeLevel", ...); a plugin
// can supply its own with a qualified name ("Media/commands/extract/foo"). Both
// resolve here against Q.handlers.

/**
 * Resolve an extractor by name. Bare names live under Streams/commands/extract;
 * a name containing a slash or dot resolves as a full handler path, so any plugin
 * can register an extractor simply by dropping a file in its handlers/ tree.
 * @method extractor
 * @static
 * @param {String} name
 * @return {Function|null}
 */
Commands.extractor = function (name) {
    if (!name || typeof name !== 'string') { return null; }
    var path = (name.indexOf('/') >= 0 || name.indexOf('.') >= 0)
        ? name
        : ('Streams/commands/extract/' + name);
    var parts = path.replace(/\//g, '.').split('.');
    var fn = Q.handlers;
    for (var i = 0; i < parts.length && fn; i++) { fn = fn[parts[i]]; }
    return (typeof fn === 'function') ? fn : null;
};

// Ergonomic alias: Streams.Commands.Extract.time(...) reads the handler subtree
// so command handlers and the entity pass can call extractors directly.
Object.defineProperty(Commands, 'Extract', {
    get: function () {
        return (Q.handlers && Q.handlers.Streams && Q.handlers.Streams.commands
            && Q.handlers.Streams.commands.extract) || {};
    }
});

module.exports = Streams_Commands;