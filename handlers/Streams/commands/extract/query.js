"use strict";

/**
 * Streams/handlers/Streams/commands/extract/query.js
 *
 * Extractor handler -> Q.handlers.Streams.commands.extract.query. Cleans a
 * navigation target: strips a leading verb phrase and a trailing noun like
 * "slide"/"card"/"page" so "go to the summary slide" -> "the summary". Used as a
 * {{query:query}} token post-processor when you want the cleaned form.
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.query
 * @param {String} text
 * @return {String|null}
 */
module.exports = function query(text) {
    var stripped = String(text || '')
        .replace(/^(go to|show me|find|jump to|navigate to|take me to|open the|show the|find the|go to the)\s+/i, '')
        .replace(/\s+(slide|card|page|section|part)\s*$/i, '')
        .trim();
    return stripped || null;
};