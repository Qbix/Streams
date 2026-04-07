/**
 * Class representing workspace rows.
 *
 * This description should be revised and expanded.
 *
 * @module Streams
 */
var Q = require('Q');
var Db = Q.require('Db');
var Workspace = Q.require('Base/Streams/Workspace');

/**
 * Class representing 'Workspace' rows in the 'Streams' database
 * @namespace Streams
 * @class Workspace
 * @extends Base.Streams.Workspace
 * @constructor
 * @param {Object} fields The fields values to initialize table row as
 * an associative array of {column: value} pairs
 */
function Streams_Workspace (fields) {

	// Run mixed-in constructors
	Streams_Workspace.constructors.apply(this, arguments);
	
	/*
 	 * Add any privileged methods to the model class here.
	 * Public methods should probably be added further below.
	 */
}

Q.mixin(Streams_Workspace, Workspace);

/*
 * Add any public methods here by assigning them to Streams_Workspace.prototype
 */

/**
 * The setUp() method is called the first time
 * an object of this class is constructed.
 * @method setUp
 */
Streams_Workspace.prototype.setUp = function () {
	// put any code here
	// overrides the Base class
};

module.exports = Streams_Workspace;