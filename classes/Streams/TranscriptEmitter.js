"use strict";

/**
 * Streams/classes/Streams/TranscriptEmitter.js
 *
 * Session-scoped EventEmitter for incremental transcript processing.
 * Node stays alive across requests; PHP doesn't. All transcript hooks
 * live here where they can maintain state across chunks within a session.
 *
 * FILE PATH
 * ─────────
 * Follows standard Qbix Streams upload path convention:
 *   {uploadsDir}/Streams/{Q.Utils.splitId(publisherId)}/{streamName}/transcript.vtt
 *
 * Q.Utils.splitId() splits the id into 3-char directory chunks:
 *   "yveaelev" → "yve/ael/ev"
 *
 * FILE FORMAT — WebVTT
 * ────────────────────
 * Utterances only — spoken words, nothing else. Non-utterance events
 * (slide advances, reactions, card shows) belong in the stream message log
 * and are cross-referenceable via the .ordinal-N class tag on each cue.
 *
 * Two exceptions where NOTE blocks appear:
 *   1. session_start — provenance: who published, which stream
 *   2. topic changes — short, one-line chapter markers useful for standalone
 *      consumers (LLMs, clip tools) who don't have DB access
 *
 * Example:
 *
 *   WEBVTT
 *   NOTE sessionStart publisherId=yveaelev streamName=Media/presentation/abc123
 *
 *   00:02:14.200 --> 00:02:17.800
 *   <v Robert Scoble><c.userId-abcjwheg.ordinal-32>AI investment has exploded</c></v>
 *
 *   NOTE topic from:AI_investment to:autonomous_vehicles
 *
 *   00:04:01.100 --> 00:04:05.200
 *   <v Robert Scoble><c.userId-abcjwheg.ordinal-47>The robotics angle is more interesting</c></v>
 *
 * CUE ANATOMY
 * ───────────
 * <v DisplayName>   — public-facing speaker name from Streams_Avatar.displayName()
 *                     shown by caption renderers to viewers
 * <c.userId-X>      — internal userId for DB querying and indexing
 * <c.ordinal-N>     — Streams_Message ordinal — direct key into the message table
 *                     WHERE streamName=... AND ordinal=N gives full instructions payload
 *
 * End time is estimated (~0.5s/word, min 1s). Deepgram word-level timestamps
 * would give exact end times — future enhancement.
 *
 * EVENTS
 * ──────
 * 'chunk'         { text, ts, relSec, speaker, sessionId, publisherId, streamName }
 * 'utteranceEnd' alias for 'chunk'
 * 'context'       { ...chunk, buffer[] } — rolling buffer of last N entries
 * 'topicChange'   { from, to, ts, relSec, isOwnLivestream, sessionId, publisherId, streamName }
 * 'sessionStart'  { sessionId, publisherId, streamName, role, lang, ts }
 * 'sessionEnd'    { sessionId, publisherId, streamName, ts, relSec, transcriptFile, chunkCount }
 */

const EventEmitter = require('events');
const fs           = require('fs');
const path         = require('path');

class TranscriptEmitter extends EventEmitter {

    constructor() {
        super();
        this.setMaxListeners(50);
    }

    // ── Public emit helpers ───────────────────────────────────────────────

    /**
     * Emit a transcript chunk event + write a VTT cue to disk.
     * Called by socket.js after Streams_Message.post() so the ordinal is known.
     *
     * @param {Object} session   The socket session object
     * @param {Object} entry     { text, ts, relSec, speaker }
     * @param {Number} [ordinal] Streams_Message ordinal — embedded as .ordinal-N in the cue.
     *                           Null/omitted if no stream is configured.
     */
    /**
     * @param {Object} [options]
     * @param {Boolean} [options.control]  True if this chunk was handled by CommandsClassifier.
     *   Adds .control class to the VTT <c> tag and marks the message instructions
     *   so the player knows not to speak this cue during replay.
     */
    emitChunk(session, entry, ordinal, options) {
        const base = this._base(session, entry);
        const isCtrl = !!(options && options.control);
        this._appendVttCue(session, entry, ordinal, isCtrl);
        const baseWithCtrl = isCtrl ? Object.assign({}, base, { control: true }) : base;
        this.emit('chunk', baseWithCtrl);
        this.emit('utteranceEnd', baseWithCtrl);
        this.emit('context', Object.assign({}, baseWithCtrl, {
            buffer: session.transcriptBuffer.slice(),
        }));
    }

    /**
     * Emit a topic change event + write a short NOTE block to the VTT file.
     * Called by Pipeline when LLM detects a conversation topic shift.
     *
     * NOTE blocks are the one non-utterance event written to the VTT because
     * they are useful chapter markers for standalone consumers (LLMs, clip tools)
     * that don't have access to the stream message log. They are short (one line)
     * and do not duplicate the full message payload.
     *
     * @param {Object} session
     * @param {String} fromTopic
     * @param {String} toTopic
     */
    emitTopicChange(session, fromTopic, toTopic, relSec) {
        const base = this._base(session);
        const evt  = Object.assign({}, base, {
            from:            fromTopic,
            to:              toTopic,
            relSec:          relSec != null ? relSec : base.relSec,
            isOwnLivestream: !!session.isOwnLivestream,
        });
        this._appendVttTopicNote(session, fromTopic, toTopic);
        this.emit('topicChange', evt);
    }

    /**
     * Emit session_start + write VTT header to a new file.
     * @param {Object} session
     * @param {Object} Q  Server-side Q object
     */
    emitSessionStart(session, Q) {
        session.transcriptFile = this._resolveTranscriptPath(session, Q);
        // Display name cache: userId → public name for <v> annotations.
        // Populated lazily on first utterance per speaker in socket.js.
        if (!session._displayNames) session._displayNames = {};

        if (session.transcriptFile) {
            this._initVttFile(session);
        }
        this.emit('sessionStart', {
            sessionId:   session.socketId,
            publisherId: session.publisherId,
            streamName:  session.streamName,
            role:        session.role,
            lang:        session.lang,
            ts:          session.sessionStartMs,
        });
    }

    /**
     * Emit session_end.
     * @param {Object} session
     */
    emitSessionEnd(session) {
        this.emit('sessionEnd', {
            sessionId:      session.socketId,
            publisherId:    session.publisherId,
            streamName:     session.streamName,
            ts:             Date.now(),
            relSec:         ((Date.now() - session.sessionStartMs) / 1000).toFixed(1),
            transcriptFile: session.transcriptFile || null,
            chunkCount:     session.transcriptBuffer ? session.transcriptBuffer.length : 0,
        });
    }

    // ── VTT file helpers ─────────────────────────────────────────────────

    /**
     * Resolve transcript .vtt path:
     *   {uploadsDir}/Streams/{Q.Utils.splitId(publisherId)}/{streamName}/transcript.vtt
     * Returns null if Q is unavailable or the directory can't be created.
     */
    _resolveTranscriptPath(session, Q) {
        if (!session.publisherId || !session.streamName) return null;
        if (!Q || !Q.Utils || typeof Q.Utils.splitId !== 'function') return null;

        let uploadsRoot = null;
        if (Q.app && Q.app.FILES_DIR) {
            uploadsRoot = path.join(Q.app.FILES_DIR, 'uploads');
        } else if (process.env.APP_WEB_DIR) {
            uploadsRoot = path.join(process.env.APP_WEB_DIR, 'Q', 'uploads');
        }
        if (!uploadsRoot) return null;

        const splitPub = Q.Utils.splitId(session.publisherId);
        const dir = path.join(uploadsRoot, 'Streams', splitPub, session.streamName);

        try {
            fs.mkdirSync(dir, { recursive: true });
            return path.join(dir, 'transcript.vtt');
        } catch (e) {
            Q.log && Q.log('TranscriptEmitter: could not create dir', dir, e.message);
            return null;
        }
    }

    /**
     * Write WEBVTT header + session_start NOTE.
     * Called once at session start.
     */
    _initVttFile(session) {
        const header = [
            'WEBVTT',
            '',
            'NOTE sessionStart'
                + ' publisherId=' + session.publisherId
                + ' streamName='  + session.streamName
                + ' role='        + (session.role || 'unknown'),
            '',
        ].join('\n');

        fs.writeFile(session.transcriptFile, header, (err) => {
            if (err) console.error('TranscriptEmitter: could not write VTT header', err.message);
        });
    }

    /**
     * Append one WebVTT cue for a final utterance.
     *
     * Format:
     *   {startTime} --> {endTime}
     *   <v DisplayName><c.userId-{id}.ordinal-{n}>{text}</c></v>
     *
     * <v DisplayName>    — public display name from Streams_Avatar (shown in renderers)
     * <c.userId-{id}>    — internal userId for querying/indexing
     * <c.ordinal-{n}>    — Streams_Message ordinal for DB cross-reference
     *
     * @param {Object} session
     * @param {Object} entry    { text, relSec, speaker }
     * @param {Number} [ordinal]
     */
    _appendVttCue(session, entry, ordinal, isControl) {
        if (!session.transcriptFile) return;

        const userId    = entry.speaker || session.userId || 'unknown';
        const startSec  = parseFloat(entry.relSec) || 0;
        const wordCount = (entry.text || '').split(/\s+/).length;
        const durSec    = Math.max(1.0, wordCount * 0.5);
        const endSec    = startSec + durSec;

        // <v> public display name — falls back to userId until cache is populated
        const displayName = (session._displayNames && session._displayNames[userId])
                          || userId;

        // <c> class tag — machine identifiers, not displayed
        // .control marks cues that were voice commands — player skips TTS for these
        const classes = '.userId-' + userId
                      + (ordinal != null ? '.ordinal-' + ordinal : '')
                      + (isControl ? '.control' : '');

        const cue = [
            '',
            _fmtVttTime(startSec) + ' --> ' + _fmtVttTime(endSec),
            '<v ' + displayName + '><c' + classes + '>' + entry.text + '</c></v>',
            '',
        ].join('\n');

        fs.appendFile(session.transcriptFile, cue, (err) => {
            if (err) console.error('TranscriptEmitter: cue write error', err.message);
        });
    }

    /**
     * Append a topic-change NOTE block.
     *   NOTE topic from:AI_investment to:autonomous_vehicles
     */
    _appendVttTopicNote(session, fromTopic, toTopic) {
        if (!session.transcriptFile) return;
        const from = fromTopic.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const to   = toTopic.replace(/\s+/g, '_').replace(/[^\w-]/g, '');
        const note = '\nNOTE topic from:' + from + ' to:' + to + '\n';
        fs.appendFile(session.transcriptFile, note, () => {});
    }

    /**
     * Append a presentation event NOTE block for events that describe what
     * was on screen — slide advances, card shows, tool appearances, access changes.
     *
     * Format (one line):
     *   NOTE {messageType} ordinal={n} {truncatedInstructions}
     *
     * Individual string values in the instructions JSON are truncated to
     * Streams/transcript/vttMaxAttrLen characters (default 512) to keep the file
     * readable while preserving the event type and key identifiers.
     * The ordinal links back to the full message row for complete data.
     *
     * Message types written as NOTEs:
     *   Media/presentation/slide      — slide navigation
     *   Media/presentation/card/show  — AI card appeared on screen
     *   Media/presentation/tool/show  — generated tool appeared
     *   Media/presentation/access     — access granted/revoked
     *
     * NOT written as NOTEs (handled separately or excluded):
     *   Media/presentation/transcript — this is the cue text itself
     *   Media/presentation/topic      — handled by _appendVttTopicNote
     *   Media/presentation/reaction   — no VTT record (message log only)
     *   Media/presentation/start/end  — handled by _initVttFile / session end
     *
     * @param {Object} session
     * @param {String} messageType    e.g. 'Media/presentation/slide'
     * @param {Number} ordinal        Streams_Message ordinal
     * @param {String} instructions   Raw JSON string from the message
     * @param {Object} [Q]            For config lookup
     */
    /**
     * @param {Number} [ts]  Wall-clock epoch ms (message.fields.sentTime).
     *   Stored in the NOTE so replay engines don't need a DB query for timing.
     */
    _appendVttEventNote(session, messageType, ordinal, instructions, Q, ts) {
        if (!session.transcriptFile) return;

        const maxLen = (Q && Q.Config)
            ? Q.Config.get(['Streams', 'transcript', 'vttMaxAttrLen'], 512)
            : 512;

        // Parse, truncate long string values, re-serialize
        let truncated = instructions || '{}';
        try {
            const obj = JSON.parse(instructions || '{}');
            truncated = JSON.stringify(_truncateValues(obj, maxLen));
        } catch (e) {
            // If not valid JSON, truncate the raw string
            if (instructions && instructions.length > maxLen) {
                truncated = instructions.slice(0, maxLen) + '...truncated';
            }
        }

        const tsStr = ts ? ' ts=' + ts : '';
        const note = '\nNOTE ' + messageType
                   + ' ordinal=' + ordinal
                   + tsStr
                   + ' ' + truncated + '\n';

        fs.appendFile(session.transcriptFile, note, () => {});
    }

    // ── Private ──────────────────────────────────────────────────────────

    _base(session, entry) {
        return {
            sessionId:   session.socketId || session.userId,
            publisherId: session.publisherId,
            streamName:  session.streamName,
            ts:          (entry && entry.ts)     || Date.now(),
            relSec:      (entry && entry.relSec) || '0.0',
            speaker:     (entry && entry.speaker)|| session.userId,
            text:        (entry && entry.text)   || '',
        };
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

const transcriptEmitter = new TranscriptEmitter();
module.exports = { transcriptEmitter, TranscriptEmitter };

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Recursively truncate string values in an object that exceed maxLen.
 * Non-string values (numbers, booleans, arrays, nested objects) are preserved
 * as-is unless they are strings. Arrays of strings are truncated element-wise.
 * @param {*}      obj     Any JSON-serializable value
 * @param {Number} maxLen  Max character length for any string value
 * @return {*} Truncated copy
 */
function _truncateValues(obj, maxLen) {
    if (typeof obj === 'string') {
        return obj.length > maxLen ? obj.slice(0, maxLen) + '…' : obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(function (item) { return _truncateValues(item, maxLen); });
    }
    if (obj !== null && typeof obj === 'object') {
        const out = {};
        for (const k of Object.keys(obj)) {
            out[k] = _truncateValues(obj[k], maxLen);
        }
        return out;
    }
    return obj;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format seconds as WebVTT timestamp: HH:MM:SS.mmm
 */
function _fmtVttTime(totalSeconds) {
    const h  = Math.floor(totalSeconds / 3600);
    const m  = Math.floor((totalSeconds % 3600) / 60);
    const s  = Math.floor(totalSeconds % 60);
    const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
    return String(h).padStart(2, '0') + ':'
         + String(m).padStart(2, '0') + ':'
         + String(s).padStart(2, '0') + '.'
         + String(ms).padStart(3, '0');
}
