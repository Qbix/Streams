"use strict";

/**
 * Streams/handlers/Streams/commands/extract/personName.js
 *
 * Extractor handler -> Q.handlers.Streams.commands.extract.personName. Pulls a
 * capitalized name out of an access phrase ("give Robert ..." -> "Robert").
 * Mostly superseded by the {{name}} token capture, but kept as a handler so the
 * entity (NER) pass can spot a name in free speech for avatar lookup.
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.personName
 * @param {String} text
 * @return {String}
 */
module.exports = function personName(text) {
    text = String(text || '');
    var m = text.match(
        /(?:give|let|allow|add|invite|remove|revoke|take away)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/
    );
    if (m) return m[1].replace(/'s$/, '').trim();
    var cap = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
    return cap ? cap[1] : '';
};