"use strict";

/**
 * Streams/handlers/Streams/commands/extract/writeLevel.js
 *
 * Extractor handler -> Q.handlers.Streams.commands.extract.writeLevel. Reads a
 * Streams write level out of text, defaulting to "post". Used by the access
 * commands via a config/registry captures map { writeLevel: "writeLevel" }.
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.writeLevel
 * @param {String} text
 * @return {String}
 */
module.exports = function writeLevel(text) {
    text = String(text || '');
    var levels = ['edit', 'post', 'contribute', 'ephemeral', 'relate'];
    var lower = text.toLowerCase();
    for (var i = 0; i < levels.length; i++) {
        if (lower.indexOf(levels[i]) !== -1) return levels[i];
    }
    return 'post';
};