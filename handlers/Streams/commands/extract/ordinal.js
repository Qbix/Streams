"use strict";

/**
 * Streams/handlers/Streams/commands/extract/ordinal.js
 *
 * Extractor handler -> Q.handlers.Streams.commands.extract.ordinal. Turns an
 * ordinal or indexed reference into a zero-based index string: "third" -> "2",
 * "bar 4" -> "3". Falls back to the first content word (e.g. for "highlight the
 * revenue chart" -> "revenue").
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.ordinal
 * @param {String} text
 * @return {String|null}
 */
module.exports = function ordinal(text) {
    text = String(text || '');
    var ordinals = {
        first:0, second:1, third:2, fourth:3, fifth:4,
        sixth:5, seventh:6, eighth:7, ninth:8, tenth:9,
        'n\u00famero uno':0, 'primero':0, 'segundo':1, 'tercero':2
    };
    for (var word in ordinals) {
        if (text.indexOf(word) !== -1) return String(ordinals[word]);
    }
    var numMatch = text.match(/(?:bar|row|item|column|entry|line)\s+(\d+)/i);
    if (numMatch) return String(parseInt(numMatch[1]) - 1);
    var afterVerb = text.replace(/highlight|point to|show me|emphasize|focus on|mark/gi, '').trim();
    var ws = afterVerb.split(/\s+/).filter(function (w) { return w.length > 2; });
    return ws[0] ? ws[0].toLowerCase() : null;
};