"use strict";

/**
 * Streams/classes/Streams/ControlClassifier.js
 *
 * Zero-latency, zero-cost control classifier.
 * Runs BEFORE the LLM pipeline on every transcript chunk.
 * On a match, emits the appropriate ephemeral directly and returns true,
 * so the caller can skip the expensive LLM path entirely.
 *
 * Pattern data lives in Streams/data/controlPhrases.json — edit that file
 * to add phrases, fix false positives, or add new locales. No code change needed.
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
     * @param {String} [options.dataFile]        Override path to controlPhrases.json
     * @param {Object} [options.Q]               Q server object for logging
     */
    constructor(options = {}) {
        this.locale        = options.locale   || 'en';
        this.Q             = options.Q        || null;
        // dataFile: explicit override only. null means _resolveCandidates() picks the path.
        // Priority: Q.pluginDir('Media','TEXT') → env var → filesystem walk → bundled data.
        this.dataFile      = options.dataFile || null;
        this._fallbackFile = path.join(__dirname, '../../data/controlPhrases.json');
        this._patterns     = null; // loaded lazily
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
    classify(text, stream, state) {
        const patterns = this._load();
        const t = text.trim().toLowerCase();
        if (!t) return false;

        const match = this._match(t, patterns);
        if (!match) return false;

        return this._emit(match.intent, match.captures, stream, state);
    }

    /**
     * Reload patterns from disk. Call after editing controlPhrases.json
     * to pick up changes without restarting Node.
     */
    reload() {
        this._patterns = null;
        this._load();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Build the ordered list of file paths to try for pattern data.
     * Checks for Media plugin presence via Q.pluginDir equivalent —
     * reads the MEDIA_PLUGIN_DIR environment variable or walks up from
     * __dirname to find plugins/Media/text/Media/commands/{locale}.json.
     * AI does not hard-depend on Media; this is an optional runtime check.
     * @private
     */
    _resolveCandidates() {
        const locale   = this.locale;
        const fallback = 'en';
        const candidates = [];

        // 1. Explicit override from constructor
        if (this.dataFile) {
            candidates.push(this.dataFile);
            if (locale !== fallback) {
                candidates.push(this._fallbackFile);
            }
            return candidates;
        }

        // 2. Media plugin text directory — optional, checked at runtime
        //    Mirrors PHP's Q::pluginDir('Media', 'WEB') pattern but for text files.
        //    Walk up from AI/classes/AI/ to find plugins/Media/text/Media/commands/
        const mediaTextDir = this._findMediaTextDir();
        if (mediaTextDir) {
            candidates.push(path.join(mediaTextDir, locale + '.json'));
            if (locale !== fallback) {
                candidates.push(path.join(mediaTextDir, fallback + '.json'));
            }
        }

        // 3. Streams plugin's own bundled fallback
        const streamsDataDir = path.join(__dirname, '../../data');
        candidates.push(path.join(streamsDataDir, 'controlPhrases.json'));

        return candidates;
    }

    /**
     * Locate Media/text/Media/commands/ via Q.pluginDir('Media', 'TEXT').
     * On Node, Q.pluginDir reads MEDIA_PLUGIN_TEXT_DIR env var, which Qbix
     * sets alongside the PHP constant of the same name.
     * Falls back to filesystem walk for dev environments without env vars.
     * @private
     */
    _findMediaTextDir() {
        // Primary: Q.pluginDir('Media', 'TEXT') — mirrors PHP Q::pluginDir()
        // Requires Q.node.patch.js merged into Q/classes/Q.js
        if (this.Q && typeof this.Q.pluginDir === 'function') {
            const textDir = this.Q.pluginDir('Media', 'TEXT');
            if (textDir) {
                const candidate = path.join(textDir, 'Media', 'commands');
                try {
                    if (require('fs').statSync(candidate).isDirectory()) return candidate;
                } catch (e) {}
            }
        }

        // Secondary: raw env var (before Q.js patch is merged)
        const envDir = process.env.MEDIA_PLUGIN_TEXT_DIR;
        if (envDir) {
            const candidate = path.join(envDir, 'Media', 'commands');
            try {
                if (require('fs').statSync(candidate).isDirectory()) return candidate;
            } catch (e) {}
        }

        // Fallback: walk up from AI/classes/AI/ to find sibling Media plugin
        let dir = __dirname;
        for (let i = 0; i < 3; i++) dir = path.dirname(dir);
        const fallback = path.join(dir, 'Media', 'text', 'Media', 'commands');
        try {
            if (require('fs').statSync(fallback).isDirectory()) return fallback;
        } catch (e) {}
        return null;
    }

    _load() {
        if (this._patterns) return this._patterns;
        let raw;
        // Try candidate paths in order:
        //   1. Explicitly configured dataFile (constructor option)
        //   2. Media plugin text directory, if Media plugin is installed
        //      (optional dependency — AI doesn't require Media)
        //   3. Streams plugin's own bundled data (controlPhrases.json)
        const candidates = this._resolveCandidates();
        let loaded = false;
        for (const filePath of candidates) {
            try {
                raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                loaded = true;
                break;
            } catch (e) {
                // try next candidate
            }
        }
        if (!loaded) {
            throw new Error('ControlClassifier: no pattern file found in: ' + candidates.join(', '));
        }
        // Detect file format:
        //   Locale-keyed: { en: { 'slide/next': ['phrase',...], ... }, es: {...} }
        //   This is the format of both Media/commands/en.json (single-locale)
        //   and AI/data/controlPhrases.json (multi-locale).
        //   Legacy: { patterns: { SlideNext: ['phrase',...] } } (old format)
        let patternMap;
        if (raw[this.locale]) {
            // Multi-locale or single-locale file — pick our locale
            patternMap = raw[this.locale];
        } else if (raw['en']) {
            // Has locales but not ours — fall back to English
            patternMap = raw['en'];
        } else if (raw.patterns) {
            // Legacy format: { patterns: { SlideNext: [...] } }
            // Map PascalCase keys to intent strings
            const keyToIntent = {
                SlideNext: 'slide/next', SlidePrev: 'slide/prev',
                SlideNavigate: 'slide/navigate',
                SlideFirst: 'slide/first', SlideLast: 'slide/last',
                VideoPlay: 'video/play', VideoPause: 'video/pause', VideoSeek: 'video/seek', VideoSeekRelative: 'video/seek/relative',
                GalleryNext: 'gallery/next', GalleryPause: 'gallery/pause',
                GalleryResume: 'gallery/resume',
                Highlight: 'highlight',
                ZoomIn: 'zoom/in', ZoomOut: 'zoom/out', ZoomReset: 'zoom/reset',
                ScrollDown: 'scroll/down', ScrollUp: 'scroll/up',
                ScrollTop: 'scroll/top', ScrollBottom: 'scroll/bottom',
                RevealNext: 'reveal/next', Fullscreen: 'fullscreen'
            };
            // Remap keys before compiling
            const remapped = {};
            for (const [k, v] of Object.entries(raw.patterns)) {
                remapped[keyToIntent[k] || k] = v;
            }
            patternMap = remapped;
        } else {
            // Raw object is the pattern map (intent → phrases)
            patternMap = raw;
        }
        const compiled = [];
        for (const [key, phrases] of Object.entries(patternMap)) {
            if (key.startsWith('_')) continue; // skip metadata keys
            const intent = key; // patternMap keys are already intent strings
            for (const phrase of phrases) {
                if (typeof phrase === 'string' && phrase.startsWith('/') && phrase.endsWith('/')) {
                    // Regex pattern: "/^next$/"
                    const rx = new RegExp(phrase.slice(1, -1), 'i');
                    compiled.push({ intent, test: t => rx.test(t), regex: rx });
                } else {
                    // Substring pattern
                    compiled.push({ intent, test: t => t.includes(phrase) });
                }
            }
        }
        this._patterns = compiled;
        return compiled;
    }

    _match(text, patterns) {
        for (const p of patterns) {
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
            'slide/prev':     () => stream.ephemeral('Streams/slide',          { slideIndex: Math.max(0, si - 1) }),
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

/**
 * Extract a time value in seconds from a natural-language string.
 * "two minutes thirty seconds" → 150
 * "1:30" → 90
 * "45 seconds" → 45
 * "three minutes" → 180
 */
function _extractTime(text) {
    // HH:MM:SS or MM:SS
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

/**
 * Extract a highlight target from the utterance.
 * "highlight the second bar" → "1" (0-indexed)
 * "highlight OpenAI" → "openai" (label substring)
 * "highlight bar 3" → "2" (0-indexed)
 */
function _extractTarget(text) {
    const ordinals = {
        first:0, second:1, third:2, fourth:3, fifth:4,
        sixth:5, seventh:6, eighth:7, ninth:8, tenth:9,
        'número uno':0, 'primero':0, 'segundo':1, 'tercero':2
    };

    for (const [word, idx] of Object.entries(ordinals)) {
        if (text.includes(word)) return String(idx);
    }

    // "bar 3" / "row 3" / "item 3"
    const numMatch = text.match(/(?:bar|row|item|column|entry|line)\s+(\d+)/i);
    if (numMatch) return String(parseInt(numMatch[1]) - 1); // 1-indexed to 0-indexed

    // Fallback: grab the longest word after the trigger verb
    // "highlight OpenAI" → "openai"
    const afterVerb = text.replace(/highlight|point to|show me|emphasize|focus on|mark/gi, '').trim();
    const words = afterVerb.split(/\s+/).filter(w => w.length > 2);
    return words[0] ? words[0].toLowerCase() : null;
}

/**
 * Extract a prompt/subject after known trigger verbs.
 * "generate an image of quantum computing" → "quantum computing"
 * "build a chess board" → "chess board"
 */
function _extractPrompt(intent, text) {
    const triggers = {
        'image/generate': ['generate an image of', 'create an image of', 'show me', 'visualize',
                           'draw', 'make a picture of', 'generate'],
        'tool/generate':  ['build a', 'create a', 'build me a', 'generate a', 'make a',
                           'show a', 'create a'],
        'stream/create':  ['create a', 'make a', "let's play", 'start a', 'set up a']
    };
    const list = triggers[intent] || [];
    // Sort longest-first so more specific phrases match first
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

/**
 * Extract a person's name from an access command utterance.
 * "give Robert access to post" → "Robert"
 * "remove John Smith's access" → "John Smith"
 */
function _extractPersonName(text) {
    // After give/let/allow/add/remove/revoke, grab capitalized run before possessive/'s or "access"
    const m = text.match(
        /(?:give|let|allow|add|invite|remove|revoke|take away)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/
    );
    if (m) return m[1].replace(/'s$/, '').trim();
    // Fallback: first capitalized word
    const cap = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    return cap ? cap[1] : '';
}

/**
 * Extract write level from access grant command.
 * "give Robert access to edit" → "edit"
 * "let John contribute" → "contribute"
 */
function _extractWriteLevel(text) {
    const levels = ['edit', 'post', 'contribute', 'ephemeral', 'relate'];
    for (const l of levels) {
        if (text.toLowerCase().includes(l)) return l;
    }
    return 'post'; // default
}


/**
 * Extract a relative time offset from a seek phrase.
 * "go back 10 seconds" → { delta: 10, forward: false }
 * "skip forward 30 seconds" → { delta: 30, forward: true }
 * "rewind two minutes" → { delta: 120, forward: false }
 */
function _extractRelativeTime(text) {
    var t = _extractTime(text);
    if (!t) return { delta: null, forward: false };
    var forwardRe = /\b(forward|ahead|skip forward|fast forward)\b/i;
    return { delta: t, forward: forwardRe.test(text) };
}

/**
 * Extract the search query from a navigation phrase.
 * "go to the product roadmap" → "product roadmap"
 * "show me the intro slide" → "intro"
 * "find climate change" → "climate change"
 */
function _extractQuery(text) {
    // Strip leading navigation verbs and filler words
    var stripped = text
        .replace(/^(go to|show me|find|jump to|navigate to|take me to|open the|show the|find the|go to the)\s+/i, '')
        .replace(/\s+(slide|card|page|section|part)\s*$/i, '')
        .trim();
    return stripped || null;
}

module.exports = ControlClassifier;
