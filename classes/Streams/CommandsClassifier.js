"use strict";

/**
 * Streams/classes/Streams/CommandsClassifier.js
 *
 * Zero-latency, zero-cost commands classifier. Fires on transcript events,
 * working over chunks to find commands. Runs BEFORE the LLM pipeline; on a match
 * it emits the appropriate ephemeral (or dispatches a registered handler) and
 * resolves to true, so the caller can skip the LLM path entirely.
 *
 * Plugin-agnostic. It does NOT name Media, AI, or any other plugin in code.
 *
 * CONFIG drives everything, under the hardcoded Streams/commands namespace,
 * grouped by the plugin that registered each command:
 *
 *   Streams/commands/{plugin}/{command} : { handler, routing, description }
 *
 * e.g.
 *
 *   Streams/commands/Media/slide/navigate : {
 *     handler: "Media.commands.slideNavigate", routing: "immediate", ...
 *   }
 *
 * The set of plugin groups here IS the set of plugins whose command text we
 * load. For each, the classifier reads {plugin TEXT dir}/{plugin}/commands/
 * {lang}.json (via Q.pluginDir(plugin, 'TEXT')) and merges its `phrases` block:
 *
 *   { "commands": { "slide/next": "Next slide", ... },   // display labels (UI)
 *     "phrases": { "slide/next": ["next slide", ...], ... } }  // recognized phrases
 *
 * Only `phrases` is read here, keyed by command. Builtin display commands
 * (slide/*, zoom/*, ...) need no config entry — they ride along in a plugin's
 * text and are emitted directly. Any command with a config `handler` is
 * dispatched by NAME, resolved against Q.handlers and called with a completion
 * callback last:
 *
 *   Q.handlers.Media.commands.slideNavigate(captures, stream, state, Q, callback)
 *
 * Slashes and dots in the handler name are interchangeable. `routing`
 * (background | veto | immediate) is pipeline metadata; a literal voice match is
 * explicit, so the classifier runs the handler directly.
 *
 * Phrase forms: "next slide" (substring), "/^next$/" (regex), "go to {{query}}"
 * (template — {{name}} compiles to a named capture group; {{name:extractor}}
 * post-processes the captured span via Streams.Commands.Extract; {{name:/re/}}
 * constrains the group to an inline pattern). Captures are assembled by
 * Streams.Commands; this classifier holds no command-specific extraction.
 *
 * @module Streams
 * @class CommandsClassifier
 */

var Q  = require('Q');
var fs = require('fs');

// Shared phrase compiler + extractors. Required lazily so a Streams class never
// hard-orders against a sibling at load time.
var _Commands = null;
function CMD() { return _Commands || (_Commands = Q.require('Streams/Commands')); }

/**
 * @constructor
 * @param {Object} [options]
 * @param {String} [options.locale='en']  Language tag, e.g. 'en', 'es', 'he'
 * @param {String} [options.dataFile]     Explicit override file ({phrases:{}} or flat).
 * @param {Object} [options.captures]     Map of command -> fn(text, command) -> captures.
 * @param {Object} [options.emits]        Map of command -> fn(captures, stream, state, Q).
 */
function Streams_CommandsClassifier(options) {
    options = options || {};
    this.locale         = options.locale   || 'en';
    this.dataFile       = options.dataFile || null;
    this._extraCaptures = options.captures || {};
    this._extraEmits    = options.emits    || {};
    this._compiled      = null;
    this._registry      = null; // command -> { plugin, handler, routing }
}

var Cp = Streams_CommandsClassifier.prototype;

// -- Public ------------------------------------------------------------------

/**
 * @method classify
 * @async
 * @param {String} text
 * @param {Object} stream
 * @param {Object} state
 * @return {Promise<Boolean>} true if handled
 */
Cp.classify = async function (text, stream, state) {
    var compiled = this._load();
    var t = (text || '').trim().toLowerCase();
    if (!t) return false;

    var match = this._match(t, compiled);
    if (!match) return false;

    return await this._emit(match.command, match.captures, stream, state);
};

/**
 * Drop the compiled-pattern and registry caches so the next classify() re-reads.
 * @method reload
 */
Cp.reload = function () {
    this._compiled = null;
    this._registry = null;
};

// -- Loading & compiling -----------------------------------------------------

/**
 * Read the grouped Streams/commands config to (a) build the command -> handler
 * registry and (b) learn which plugins registered commands. Load each such
 * plugin's {plugin}/commands/{locale}.json `phrases` block (en fallback per
 * plugin) and compile. Each file is read in its own try/catch, so a plugin with
 * no text for this locale is simply skipped.
 * @method _load
 * @private
 */
Cp._load = function () {
    if (this._compiled) return this._compiled;

    var config  = Q.Config.get(['Streams', 'commands'], {}) || {};
    var plugins = Object.keys(config);

    // (a) registry: command -> { plugin, handler, routing }
    var registry = {};
    plugins.forEach(function (plugin) {
        var group = config[plugin] || {};
        Object.keys(group).forEach(function (command) {
            var spec = group[command];
            if (spec && typeof spec === 'object' && spec.handler) {
                registry[command] = { plugin: plugin, handler: spec.handler, routing: spec.routing, captures: spec.captures };
            }
        });
    });
    this._registry = registry;

    // (b) phrases: merge each registered plugin's phrases block
    var map = {};
    if (this.dataFile) {
        var raw = _loadJsonSync(this.dataFile);
        map = raw.phrases || raw;
    } else {
        var locale = this.locale;
        plugins.forEach(function (plugin) {
            var dir = Q.pluginDir(plugin, 'TEXT');
            if (!dir) return;
            var files = [dir + '/' + plugin + '/commands/' + locale + '.json'];
            if (locale !== 'en') {
                files.push(dir + '/' + plugin + '/commands/en.json');
            }
            for (var f = 0; f < files.length; f++) {
                try {
                    var data = _loadJsonSync(files[f]);
                    var phrases = data.phrases || {};
                    for (var k in phrases) { map[k] = phrases[k]; }
                    break;
                } catch (e) {
                    // no file at this path/locale -- try next, or next plugin
                }
            }
        });
    }

    var compiled = [];
    Object.keys(map).forEach(function (command) {
        if (command.charAt(0) === '_') return;
        var phrases = map[command];
        if (!Array.isArray(phrases)) return;
        phrases.forEach(function (phrase) {
            var tester = CMD().compile(phrase);
            if (tester) { tester.command = command; compiled.push(tester); }
        });
    });

    this._compiled = compiled;
    return compiled;
};

/**
 * First-match-wins over compiled phrases, in load order.
 * @method _match
 * @private
 */
Cp._match = function (text, compiled) {
    for (var i = 0; i < compiled.length; i++) {
        if (compiled[i].test(text)) {
            return {
                command:  compiled[i].command,
                captures: this._captures(compiled[i].command, text, compiled[i])
            };
        }
    }
    return null;
};

/**
 * Build the captures object for a matched command, generically:
 *   1. injected extractor for the command (constructor option) wins outright;
 *   2. {{named}} groups from the matched phrase (with any {{x:extractor}} or
 *      {{x:/regex/}} rule applied) via Streams.Commands.captures;
 *   3. captures a registered emit-command declares (Streams.Commands.registry),
 *      scanned from the whole utterance;
 *   4. captures a handler command declares in config, also scanned whole-text.
 * No command names are special-cased here.
 * @method _captures
 * @private
 */
Cp._captures = function (command, text, tester) {
    if (this._extraCaptures[command]) {
        return this._extraCaptures[command](text, command) || {};
    }
    var Commands = CMD();
    var caps = Commands.captures(tester, text);

    // captures declared by a registered emit-command (e.g. Media's video/seek)
    var emitSpec = Commands.registry && Commands.registry[command];
    if (emitSpec && emitSpec.captures) {
        Commands.scan(emitSpec.captures, text, caps);
    }
    // captures declared by a handler command in plugin.json config
    var spec = this._registry && this._registry[command];
    if (spec && spec.captures) {
        Commands.scan(spec.captures, text, caps);
    }
    return caps;
};

// -- Emission & dispatch -----------------------------------------------------

/**
 * Emit the ephemeral for a command, or dispatch its registered handler.
 * Order: injected emit (async; false = fall through) -> built-in emit map
 * (Streams/* and Q/* only) -> handler from the registry (command -> handler
 * name), resolved against Q.handlers and called with a completion callback last.
 * @method _emit
 * @async
 * @private
 */
Cp._emit = async function (command, captures, stream, state) {
    if (this._extraEmits[command]) {
        var injected = await this._extraEmits[command](captures, stream, state, Q);
        if (injected !== false) {
            Q.log && Q.log('Streams.CommandsClassifier classified (injected): "' + command + '"');
            return injected === undefined ? true : !!injected;
        }
    }

    // Display behavior is registered by the owning plugin, not hardcoded here:
    // Media registers slide/zoom/scroll/gallery/video emitters into
    // Streams.Commands.registry. The classifier stays generic.
    var reg = CMD().registry && CMD().registry[command];
    if (reg && typeof reg.emit === 'function') {
        reg.emit(captures, stream, state, Q);
        Q.log && Q.log('Streams.CommandsClassifier classified: "' + command + '"');
        return true;
    }

    var spec = this._registry && this._registry[command];
    if (!spec || !spec.handler) return false;

    var fn = _resolveHandler(spec.handler);
    if (typeof fn !== 'function') {
        Q.log && Q.log('Streams.CommandsClassifier: handler "' + spec.handler +
            '" for command "' + command + '" not found in Q.handlers');
        return false;
    }

    var done = function (err) {
        if (err) {
            Q.log && Q.log('Streams.CommandsClassifier: handler "' + spec.handler +
                '" error', (err && err.message) || err);
        }
    };

    Q.log && Q.log('Streams.CommandsClassifier dispatching to handler: "' + spec.handler + '"');
    if (command.indexOf('stream/') === 0) {
        fn({
            command:         command.replace('stream/', ''),
            userId:          state.userId,
            publisherId:     state.publisherId,
            streamName:      state.streamName,
            chatPublisherId: state.userId,
            chatStreamName:  state.toolStreamName,
            targetName:      captures.name || '',
            targetUserId:    captures.targetUserId || '',
            writeLevel:      captures.writeLevel || 'post',
            toolTitle:       captures.prompt || 'Tool'
        }, Q, state.Users, done);
    } else {
        fn(captures, stream, state, Q, done);
    }
    return true;
};

// -- Helpers -----------------------------------------------------------------

function _resolveHandler(handlerName) {
    var parts = handlerName.replace(/\//g, '.').split('.');
    var fn = Q.handlers;
    for (var p = 0; p < parts.length; p++) {
        fn = fn && fn[parts[p]];
    }
    return fn;
}


function _loadJsonSync(file) {
    var data = fs.readFileSync(file, 'utf-8');
    if (file.slice(-4).toLowerCase() === '.php') {
        data = data.substring(data.indexOf("\n") + 1, data.lastIndexOf("\n"));
    }
    data = data.replace(/\s*(?!<")\/\*[^\*]+\*\/(?!")\s*/gi, '');
    data = data.replace(/\,\s*\}/, '}');
    return JSON.parse(data);
}

module.exports = Streams_CommandsClassifier;