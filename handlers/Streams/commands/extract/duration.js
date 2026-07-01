"use strict";

/**
 * Streams/handlers/Streams/commands/extract/duration.js
 *
 * Extractor handler -> Q.handlers.Streams.commands.extract.duration. Reads a
 * relative seek out of text: the magnitude (delegated to the time extractor) and
 * a direction from words like "forward"/"back". Returns { delta, forward }, which
 * the captures step merges into the captures object.
 *
 * It reads direction from the full utterance, so when used as a {{x:duration}}
 * token it receives (span, fullText) and prefers fullText.
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.duration
 * @param {String} value  captured span (when used as a token post-processor)
 * @param {String} [text] full utterance (used for direction)
 * @return {Object} { delta:Number|null, forward:Boolean }
 */
var Q = require('Q');

module.exports = function duration(value, text) {
    text = String(text || value || '');
    var time = Q.handlers.Streams.commands.extract.time;
    var t = (typeof time === 'function') ? time(text) : null;
    if (!t) { return { delta: null, forward: false }; }
    return { delta: t, forward: /\b(forward|ahead|skip forward|fast forward)\b/i.test(text) };
};