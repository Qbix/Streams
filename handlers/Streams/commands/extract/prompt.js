"use strict";

/**
 * Streams/handlers/Streams/commands/extract/prompt.js
 *
 * Extractor handler -> Q.handlers.Streams.commands.extract.prompt. Light cleanup
 * for a captured prompt span: strips a leading article. The {{prompt}} token
 * already isolates the text; this just tidies it when referenced as
 * {{prompt:prompt}}.
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.prompt
 * @param {String} value
 * @return {String}
 */
module.exports = function prompt(value) {
    return String(value == null ? '' : value).trim().replace(/^(the|a|an)\s+/i, '');
};