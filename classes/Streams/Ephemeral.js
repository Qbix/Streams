/**
 * Class representing Streams/Ephemeral.
 *
 * This description should be revised and expanded.
 *
 * @module Streams
 */
var Q = require('Q');

/**
 * Streams Ephemeral
 * @namespace Streams
 * @class Ephemeral
 * @constructor
 * @param {Object} payload an associative array of {column: value} pairs
 * @param {Streams.Stream} stream through which the ephemeral will be broadcast
 * @param {Integer} [timestamp=Date.now()] defaults to current timestanp
 */
function Streams_Ephemeral (payload, timestamp) {
    this.payload = payload;
    this.timestamp = timestamp || Date.now() / 1000;
}

var Ep = Streams_Ephemeral.prototype = {
    className: "Streams_Ephemeral",
};

/**
 * Get the type of the Ephemeral
 * @method getType
 * @return {string}
 */
Ep.getType = function () {
    return this.payload.type;
};

/**
 * Get a copy of the fields of the Ephemeral
 * @method getFields
 * @return {string}
 */
Ep.getFields = function () {
    return Q.copy(this.payload);
};

/**
 * This method is here for some ephemerals designed to be compatible with messages.
 * Get all the instructions from an ephemeral, by JSON parsing this.instructions
 * If instructions is not set, or if there is an error, still returns an object, but it's empty.
 * @method getAllInstructions
 * @return {Object}
 */
Ep.getAllInstructions = function _Ephemeral_prototype_getAllInstructions () {
    try {
        return JSON.parse(this.instructions);
    } catch (e) {
        return {};
    }
};

/**
 * This method is here for some ephemerals designed to be compatible with messages.
 * Get the value of an instruction in the ephemeral, if any, otherwise return undefined.
 * @method getInstruction
 * @param {String} instructionName
 * @return {any}
 */
Ep.getInstruction = function _Ephemeral_prototype_getInstruction (instructionName) {
    var instr = this.getAllInstructions();
    return Q.getObject([instructionName], instr);
};

module.exports = Streams_Ephemeral;