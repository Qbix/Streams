"use strict";

/**
 * Streams/handlers/Streams/commands/extract/time.js
 *
 * Extractor handler. Auto-loaded by Bootstrap.loadHandlers into
 * Q.handlers.Streams.commands.extract.time. Parses a clock or spoken duration
 * out of text into seconds: "3:20" -> 200, "two minutes" -> 120, "1:02:03" ->
 * 3723. Returns null when nothing time-like is present.
 *
 * Capture rules reference it by the bare name "time" (in a phrase token
 * {{pos:time}} or a config/registry captures map { pos: "time" }); the classifier
 * resolves that against Q.handlers via Streams.Commands. Command handlers and the
 * entity pass can also call it directly.
 *
 * @module Streams
 * @class Q.handlers.Streams.commands.extract.time
 * @param {String} text
 * @return {Number|null} seconds
 */
module.exports = function time(text) {
    text = String(text || '');
    var colonMatch = text.match(/(\d+):(\d+)(?::(\d+))?/);
    if (colonMatch) {
        var a = parseInt(colonMatch[1]);
        var b = parseInt(colonMatch[2]);
        var c = colonMatch[3] != null ? parseInt(colonMatch[3]) : null;
        return c != null ? a * 3600 + b * 60 + c : a * 60 + b;
    }
    var words = {
        zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7,
        eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
        fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18,
        nineteen:19, twenty:20, thirty:30, forty:40, fifty:50
    };
    var toNum = function (s) {
        var n = parseFloat(s);
        if (!isNaN(n)) return n;
        var w = words[String(s).toLowerCase()];
        return w != null ? w : null;
    };
    var total = 0;
    var hourMatch = text.match(/(\w+)\s+hours?/);
    var minMatch  = text.match(/(\w+)\s+minutes?/);
    var secMatch  = text.match(/(\w+)\s+seconds?/);
    if (hourMatch) { var vh = toNum(hourMatch[1]); if (vh != null) total += vh * 3600; }
    if (minMatch)  { var vm = toNum(minMatch[1]);  if (vm != null) total += vm * 60;   }
    if (secMatch)  { var vs = toNum(secMatch[1]);  if (vs != null) total += vs;         }
    return total > 0 ? total : null;
};