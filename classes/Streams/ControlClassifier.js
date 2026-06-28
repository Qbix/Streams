"use strict";

/**
 * Streams/classes/Streams/ControlClassifier.js
 *
 * Zero-latency, zero-cost control classifier.
 * Runs BEFORE the LLM pipeline on every transcript chunk.
 * On a match, emits the appropriate ephemeral directly and returns true,
 * so the caller can skip the expensive LLM path entirely.
 *
 * Pattern data lives in per-locale files under
 *   plugins/Streams/text/Streams/controlPhrases/<locale>.json
 * Edit those files to add phrases, fix false positives, or add new locales.
 * No code change needed.
 *
 * The frontend reads the same files (one per locale, fetched on demand)
 * so backend and client classifiers always operate on identical pattern sets.
 *
 * Usage in AI/socket.js:
 *   const classifier = new ControlClassifier({ locale: 'en' });
 *   // on each final transcript chunk:
 *   const handled = await classifier.classify(text, stream, currentState);
 *   if (handled) return; // skip LLM
 *
 * @module AI
 * @class ControlClassifier
 */

const path = require('path');
const fs   = require('fs');

class ControlClassifier {

    /**
     * @param {Object} [options]
     * @param {String} [options.locale='en']     BCP-47 language tag, e.g. 'en', 'es', 'he'
     * @param {String} [options.dataDir]         Override base directory for phrase files
     *                                           (default: plugins/Streams/text/Streams/controlPhrases)
     * @param {Object} [options.Q]               Q server object for logging
     */
    constructor(options = {}) {
        this.locale  = options.locale || 'en';
        this.Q       = options.Q      || null;
        // dataDir: explicit override only. null means _resolveDataDir() picks it.
        this.dataDir = options.dataDir || null;
        this._patterns = null; // loaded lazily
    }

    // ── Public ────────────────────────────────────────────────────────────────

    /**
     * Test a transcript chunk against control patterns.
     * Returns true and emits ephemeral(s) if a match is found.
     * Returns false if no match — caller should proceed to LLM pipeline.
     *
     * @param {String}         text         Final transcript text (single utterance)
     * @param {Streams_Stream} stream       The presentation or session stream
     * @param {Object}         state        Current presentation state
     *   @param {Number}  state.slideIndex  Current slide index
     *   @param {Number}  state.revealIndex Current reveal index
     *   @param {Number}  state.zoomScale   Current zoom scale (default 1)
     * @return {Boolean} true if handled
     */
    classify(text, stream, state, allowedIntents) {
        const patterns = this._load();
        const t = text.trim().toLowerCase();
        if (!t) return false;

        const match = this._match(t, patterns, allowedIntents);
        if (!match) return false;
        return this._emit(match.intent, match.captures, stream, state);
    }

    /**
     * Reload patterns from disk. Call after editing the locale's phrase
     * file to pick up changes without restarting Node.
     */
    reload() {
        this._patterns = null;
        this._load();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Resolve the base directory containing per-locale phrase files.
     * Priority:
     *   1. Explicit dataDir from constructor
     *   2. Streams plugin's text directory: plugins/Streams/text/Streams/controlPhrases
     *      (located by walking up from __dirname, which is .../Streams/classes/Streams/)
     *
     * @private
     * @return {String}  Absolute path to the controlPhrases directory
     */
    _resolveDataDir() {
        if (this.dataDir) return this.dataDir;

        // __dirname is .../plugins/Streams/classes/Streams
        // Walk up two levels to reach .../plugins/Streams/
        // then into text/Streams/controlPhrases/
        const streamsPluginDir = path.resolve(__dirname, '..', '..');
        return path.join(streamsPluginDir, 'text', 'Streams', 'controlPhrases');
    }

    /**
     * Build the ordered list of file paths to try for pattern data.
     * Each file represents a single locale, named <locale>.json.
     *
     * For locale "en-US": try en_US.json, then en.json (language fallback).
     * For locale "en":    try en.json.
     *
     * @private
     * @return {Array<String>}  Ordered list of candidate file paths
     */
    _resolveCandidates() {
        const dir = this._resolveDataDir();
        const locale = this.locale;
        const candidates = [];

        // Specific locale (e.g. en-US → en_US.json or en_AS.json)
        // BCP-47 uses hyphens; filenames use underscores.
        const fileSafe = locale.replace(/-/g, '_');
        candidates.push(path.join(dir, fileSafe + '.json'));

        // Language fallback (e.g. en-US → en.json)
        const lang = locale.split(/[-_]/)[0];
        if (lang !== fileSafe) {
            candidates.push(path.join(dir, lang + '.json'));
        }

        // Ultimate fallback to English if the locale's language differs
        if (lang !== 'en') {
            candidates.push(path.join(dir, 'en.json'));
        }

        return candidates;
    }

    /**
     * Load and compile patterns. Reads the first candidate file that
     * exists in the locale fallback chain — this is the canonical source
     * of phrases. No multi-file merging: one locale = one file.
     *
     * Frontend and backend share these files, so editing en.json updates
     * both classifiers automatically.
     *
     * @private
     */
    _load() {
        if (this._patterns) return this._patterns;

        const candidates = this._resolveCandidates();
        let raw = null;
        let loadedFrom = null;

        for (const filePath of candidates) {
            try {
                raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                loadedFrom = filePath;
                break;
            } catch (e) {
                // File missing or malformed — try next in fallback chain
            }
        }

        if (!raw) {
            throw new Error(
                'ControlClassifier: no pattern file found for locale "' +
                this.locale + '" in: ' + candidates.join(', ')
            );
        }

        this._log('loaded patterns from: ' + loadedFrom);

        // ── File format ───────────────────────────────────────────────
        // Each per-locale file contains a flat object mapping intents to
        // arrays of phrases. Phrases are either substring patterns or
        // regex patterns wrapped in slashes:
        //
        //   {
        //     "_intents": "...documentation comment...",
        //     "slide/next": ["next slide", "advance", "/^next$/"],
        //     "slide/prev": ["previous slide", "go back"],
        //     ...
        //   }
        //
        // Keys starting with "_" are metadata (documentation) and skipped.

        const compiled = [];
        for (const [intent, phrases] of Object.entries(raw)) {
            if (intent.startsWith('_')) continue;
            if (!Array.isArray(phrases)) continue;
            for (const phrase of phrases) {
                if (typeof phrase === 'string'
                    && phrase.startsWith('/') && phrase.endsWith('/')) {
                    // Regex pattern: "/^next$/"
                    const rx = new RegExp(phrase.slice(1, -1), 'i');
                    compiled.push({ intent, test: t => rx.test(t), regex: rx });
                } else {
                    // Substring pattern
                    //compiled.push({ intent, test: t => t.includes(phrase) });

                    function escapeRegex(str) {
                        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    }

                    var phraseRe = new RegExp(
                        '^\\s*' + escapeRegex(phrase) + '\\s*[.!?]?\\s*$',
                        'i'
                    );

                    compiled.push({
                        intent,
                        test: t => phraseRe.test(t)
                    });
                }
            }
        }

        this._patterns = compiled;
        return compiled;
    }

    _match(text, patterns, allowedIntents) {
        for (const p of patterns) {
            if (allowedIntents && !allowedIntents.has(p.intent)) continue;
            if (p.test(text)) {
                return { intent: p.intent, captures: this._captures(p.intent, text) };
            }
        }
        return null;
    }

    /**
     * Extract secondary data from the utterance for intents that need it.
     */
    _captures(intent, text) {
        if (intent === 'video/seek') {
            var t = _extractTime(text);
            return { pos: t };
        }
        if (intent === 'video/seek/relative') {
            var rel = _extractRelativeTime(text);
            return rel;
        }
        if (intent === 'slide/navigate') {
            return { query: _extractQuery(text) };
        }
        if (intent === 'highlight') {
            return { elementId: _extractTarget(text) };
        }
        // Image/tool generation: extract prompt after trigger verb
        if (intent === 'image/generate' || intent === 'tool/generate') {
            return { prompt: _extractPrompt(intent, text) };
        }
        // Stream commands: extract target name (person) and optional write level
        if (intent === 'stream/grantAccess' || intent === 'stream/revokeAccess') {
            return {
                name:       _extractPersonName(text),
                writeLevel: _extractWriteLevel(text)
            };
        }
        if (intent === 'stream/create') {
            return { prompt: _extractPrompt(intent, text) };
        }
        return {};
    }

    /**
     * Emit the appropriate ephemeral on the stream given an intent.
     * Returns true if handled, false if intent unknown (shouldn't happen).
     */
    _emit(intent, captures, stream, state) {
        const si = (state && state.slideIndex)   || 0;
        const ri = (state && state.revealIndex)  || 0;
        const zs = (state && state.zoomScale)    || 1;
        const SCROLL_STEP = 20; // percent

        const map = {
            'slide/next':     () => stream.ephemeral('Streams/slide',          { slideIndex: si + 1 }),
            'slide/prev':     () => {
                let slideToSwitch = Math.max(0, si - 1);
                stream.ephemeral('Streams/slide', { slideIndex: slideToSwitch })
            },
            'slide/first':    () => stream.ephemeral('Streams/slide',          { slideIndex: 0 }),
            'slide/last':     () => stream.ephemeral('Streams/slide',          { slideIndex: 9999 }), // presentation tool caps at max
            'video/play':     () => stream.ephemeral('Streams/play',           {}),
            'video/pause':    () => stream.ephemeral('Streams/pause',          {}),
            'video/seek':          () => captures.pos != null && stream.ephemeral('Streams/seek', { pos: captures.pos }),
            'video/seek/relative': () => captures.delta != null && stream.ephemeral('Streams/seek', {
                pos: (captures.forward ? '+' : '-') + captures.delta
            }),
            'gallery/next':           () => stream.ephemeral('Streams/gallery/next',    {}),
            'gallery/pause':          () => stream.ephemeral('Streams/gallery/pause',   {}),
            'gallery/resume':         () => stream.ephemeral('Streams/gallery/resume',  {}),
            'gallery/caption/remove': () => stream.ephemeral('Streams/gallery/caption', { remove: true }),
            'gallery/remove':         () => stream.ephemeral('Streams/gallery/remove',  {}),
            'highlight':      () => captures.elementId && stream.ephemeral('Streams/highlight', { elementId: captures.elementId }),
            'zoom/in':        () => stream.ephemeral('Streams/zoom',           { scale: +(zs * 1.5).toFixed(2) }),
            'zoom/out':       () => stream.ephemeral('Streams/zoom',           { scale: +(zs / 1.5).toFixed(2) }),
            'zoom/reset':     () => stream.ephemeral('Streams/zoom',           { scale: 1 }),
            'scroll/down':    () => stream.ephemeral('Q/scroll',               { top: `+${SCROLL_STEP}%` }),
            'scroll/up':      () => stream.ephemeral('Q/scroll',               { top: `-${SCROLL_STEP}%` }),
            'scroll/top':     () => stream.ephemeral('Q/scroll',               { top: '0%' }),
            'scroll/bottom':  () => stream.ephemeral('Q/scroll',               { top: '100%' }),
            'reveal/next':    () => stream.ephemeral('Streams/reveal',         { revealIndex: ri + 1 }),
            'fullscreen':     () => stream.ephemeral('Q/fullscreen',           {}),
        };

        const handler = map[intent];
        if (handler) {
            handler();
            this._log(`classified: "${intent}"`, captures);
            return true;
        }

        // Fall through to Q.handlers for plugin-defined commands.
        // Config at AI/commands/{intent}/handler points to a handler path.
        // e.g. AI/commands/image/generate/handler = "AI/commands/imageGenerate"
        // The handler receives (captures, stream, state, Q) and returns a Promise.
        if (this.Q) {
            const intentKey = intent; // Config.get uses array path, intent is already the key
            const handlerPath = this.Q.Config
                && this.Q.Config.get(['AI', 'commands', intentKey, 'handler'], null);
            if (handlerPath && this.Q.handlers) {
                // Resolve dot-path into Q.handlers object
                const parts = handlerPath.replace(/\//g, '.').split('.');
                let fn = this.Q.handlers;
                for (const p of parts) {
                    fn = fn && fn[p];
                }
                if (typeof fn === 'function') {
                    this._log(`dispatching to handler: "${handlerPath}"`, captures);
                    // Stream commands need extra context from the session
                    // For stream/* intents, build a params object with session context
                    if (intent.startsWith('stream/')) {
                        const Users = state.Users;
                        fn({
                            command:                intent.replace('stream/', ''),
                            userId:                 state.userId,
                            publisherId:            state.publisherId,
                            streamName:             state.streamName,
                            chatPublisherId:        state.userId,
                            chatStreamName:         state.toolStreamName,
                            targetName:             captures.name || '',
                            targetUserId:           captures.targetUserId || '',
                            writeLevel:             captures.writeLevel || 'post',
                            toolTitle:              captures.prompt || 'Tool',
                        }, this.Q, Users);
                    } else {
                        fn(captures, stream, state, this.Q);
                    }
                    return true;
                }
            }
        }

        return false;
    }

    _log(msg, data) {
        if (this.Q) {
            this.Q.log('ControlClassifier', msg, data || '');
        } else {
            console.log('[ControlClassifier]', msg, data || '');
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// (Unchanged from previous version — all _extract* functions identical.)

/**
 * Extract a time value in seconds from a natural-language string.
 * "two minutes thirty seconds" → 150
 * "1:30" → 90
 * "45 seconds" → 45
 * "three minutes" → 180
 */
function _extractTime(text) {
    const colonMatch = text.match(/(\d+):(\d+)(?::(\d+))?/);
    if (colonMatch) {
        const [, a, b, c] = colonMatch;
        return c != null
            ? parseInt(a) * 3600 + parseInt(b) * 60 + parseInt(c)
            : parseInt(a) * 60  + parseInt(b);
    }

    const words = {
        zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
        eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
        fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18,
        nineteen:19, twenty:20, thirty:30, forty:40, fifty:50
    };

    const toNum = s => {
        const n = parseFloat(s);
        if (!isNaN(n)) return n;
        return words[s.toLowerCase()] ?? null;
    };

    let total = 0;
    const hourMatch = text.match(/(\w+)\s+hours?/);
    const minMatch  = text.match(/(\w+)\s+minutes?/);
    const secMatch  = text.match(/(\w+)\s+seconds?/);

    if (hourMatch) { const v = toNum(hourMatch[1]); if (v != null) total += v * 3600; }
    if (minMatch)  { const v = toNum(minMatch[1]);  if (v != null) total += v * 60;   }
    if (secMatch)  { const v = toNum(secMatch[1]);  if (v != null) total += v;         }

    return total > 0 ? total : null;
}

function _extractTarget(text) {
    const ordinals = {
        first:0, second:1, third:2, fourth:3, fifth:4,
        sixth:5, seventh:6, eighth:7, ninth:8, tenth:9,
        'número uno':0, 'primero':0, 'segundo':1, 'tercero':2
    };

    for (const [word, idx] of Object.entries(ordinals)) {
        if (text.includes(word)) return String(idx);
    }

    const numMatch = text.match(/(?:bar|row|item|column|entry|line)\s+(\d+)/i);
    if (numMatch) return String(parseInt(numMatch[1]) - 1);

    const afterVerb = text.replace(/highlight|point to|show me|emphasize|focus on|mark/gi, '').trim();
    const words = afterVerb.split(/\s+/).filter(w => w.length > 2);
    return words[0] ? words[0].toLowerCase() : null;
}

function _extractPrompt(intent, text) {
    const triggers = {
        'image/generate': ['generate an image of', 'create an image of', 'show me', 'visualize',
                           'draw', 'make a picture of', 'generate'],
        'tool/generate':  ['build a', 'create a', 'build me a', 'generate a', 'make a',
                           'show a', 'create a'],
        'stream/create':  ['create a', 'make a', "let's play", 'start a', 'set up a']
    };
    const list = triggers[intent] || [];
    const sorted = list.slice().sort((a, b) => b.length - a.length);
    const lower = text.toLowerCase();
    for (const t of sorted) {
        const idx = lower.indexOf(t);
        if (idx >= 0) {
            return text.slice(idx + t.length).trim().replace(/^(the|a|an)\s+/i, '');
        }
    }
    return text.trim();
}

function _extractPersonName(text) {
    const m = text.match(
        /(?:give|let|allow|add|invite|remove|revoke|take away)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/
    );
    if (m) return m[1].replace(/'s$/, '').trim();
    const cap = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    return cap ? cap[1] : '';
}

function _extractWriteLevel(text) {
    const levels = ['edit', 'post', 'contribute', 'ephemeral', 'relate'];
    for (const l of levels) {
        if (text.toLowerCase().includes(l)) return l;
    }
    return 'post';
}

function _extractRelativeTime(text) {
    var t = _extractTime(text);
    if (!t) return { delta: null, forward: false };
    var forwardRe = /\b(forward|ahead|skip forward|fast forward)\b/i;
    return { delta: t, forward: forwardRe.test(text) };
}

function _extractQuery(text) {
    var stripped = text
        .replace(/^(go to|show me|find|jump to|navigate to|take me to|open the|show the|find the|go to the)\s+/i, '')
        .replace(/\s+(slide|card|page|section|part)\s*$/i, '')
        .trim();
    return stripped || null;
}

module.exports = ControlClassifier;