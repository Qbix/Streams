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
 * Get all the instructions from a message.
 * 
 * @method getAllInstructions
 */
Ep.getAllInstructions = function _Message_prototype_getAllInstructions () {
    try {
        return JSON.parse(this.fields.instructions);
    } catch (e) {
        return undefined;
    }
};

/**
 * Get the value of an instruction in the message
 * 
 * @method getInstruction
 * @param {String} instructionName
 */
Ep.getInstruction = function _Message_prototype_get (instructionName) {
    var instr = this.getAllInstructions();
    return Q.getObject([instructionName], instr);
};


module.exports = Streams_Ephemeral;