/**
 * Autogenerated base class representing invited rows
 * in the Streams database.
 *
 * Don't change this file, since it can be overwritten.
 * Instead, change the Streams/Invited.js file.
 *
 * @module Streams
 */

var Q = require('Q');
var Db = Q.require('Db');
var Streams = Q.require('Streams');
var Row = Q.require('Db/Row');

/**
 * Base class representing 'Invited' rows in the 'Streams' database
 * @namespace Base.Streams
 * @class Invited
 * @extends Db.Row
 * @constructor
 * @param {Object} [fields={}] The fields values to initialize table row as 
 * an associative array of {column: value} pairs
 * @param {String|Buffer} [fields.userId] defaults to ""
 * @param {String|Buffer} [fields.token] defaults to ""
 * @param {String} [fields.state] defaults to "pending"
 * @param {String|Db.Expression} [fields.insertedTime] defaults to new Db.Expression("CURRENT_TIMESTAMP")
 * @param {String|Db.Expression} [fields.updatedTime] defaults to null
 * @param {String|Db.Expression} [fields.expireTime] defaults to null
 */
function Base (fields) {
	Base.constructors.apply(this, arguments);
}

Q.mixin(Base, Row);

/**
 * @property userId
 * @type String|Buffer
 * @default ""
 * id of user who is being invited to the stream
 */
/**
 * @property token
 * @type String|Buffer
 * @default ""
 * unique random token for the link, to embed in invitation URLs
 */
/**
 * @property state
 * @type String
 * @default "pending"
 * the state of the invite
 */
/**
 * @property insertedTime
 * @type String|Db.Expression
 * @default new Db.Expression("CURRENT_TIMESTAMP")
 * 
 */
/**
 * @property updatedTime
 * @type String|Db.Expression
 * @default null
 * 
 */
/**
 * @property expireTime
 * @type String|Db.Expression
 * @default null
 * 
 */

/**
 * This method calls Db.connect() using information stored in the configuration.
 * If this has already been called, then the same db object is returned.
 * @method db
 * @return {Db} The database connection
 */
Base.db = function () {
	return Streams.db();
};

/**
 * Retrieve the table name to use in SQL statements
 * @method table
 * @param {boolean} [withoutDbName=false] Indicates wheather table name should contain the database name
 * @return {String|Db.Expression} The table name as string optionally without database name if no table sharding was started
 * or Db.Expression object with prefix and database name templates is table was sharded
 */
Base.table = function (withoutDbName) {
	if (Q.Config.get(['Db', 'connections', 'Streams', 'indexes', 'Invited'], false)) {
		return new Db.Expression((withoutDbName ? '' : '{{dbname}}.')+'{{prefix}}invited');
	} else {
		var conn = Db.getConnection('Streams');
		var prefix = conn.prefix || '';
		var tableName = prefix + 'invited';
		var dbname = Base.table.dbname;
		if (!dbname) {
			var dsn = Db.parseDsnString(conn['dsn']);
			dbname = Base.table.dbname = dsn.dbname;
		}
		return withoutDbName ? tableName : dbname + '.' + tableName;
	}
};

/**
 * The connection name for the class
 * @method connectionName
 * @return {String} The name of the connection
 */
Base.connectionName = function() {
	return 'Streams';
};

/**
 * Create SELECT query to the class table
 * @method SELECT
 * @param {String|Object} [fields=null] The fields as strings, or object of {alias:field} pairs.
 *   The default is to return all fields of the table.
 * @param {String|Object} [alias=null] The tables as strings, or object of {alias:table} pairs.
 * @return {Db.Query.Mysql} The generated query
 */
Base.SELECT = function(fields, alias) {
	if (!fields) {
		fields = Base.fieldNames().map(function (fn) {
			return fn;
		}).join(',');
	}
	var q = Base.db().SELECT(fields, Base.table()+(alias ? ' '+alias : ''));
	q.className = 'Streams_Invited';
	return q;
};

/**
 * Create UPDATE query to the class table. Use Db.Query.Mysql.set() method to define SET clause
 * @method UPDATE
 * @param {String} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.UPDATE = function(alias) {
	var q = Base.db().UPDATE(Base.table()+(alias ? ' '+alias : ''));
	q.className = 'Streams_Invited';
	return q;
};

/**
 * Create DELETE query to the class table
 * @method DELETE
 * @param {Object}[table_using=null] If set, adds a USING clause with this table
 * @param {String} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.DELETE = function(table_using, alias) {
	var q = Base.db().DELETE(Base.table()+(alias ? ' '+alias : ''), table_using);
	q.className = 'Streams_Invited';
	return q;
};

/**
 * Create INSERT query to the class table
 * @method INSERT
 * @param {Object} [fields={}] The fields as an associative array of {column: value} pairs
 * @param {String} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.INSERT = function(fields, alias) {
	var q = Base.db().INSERT(Base.table()+(alias ? ' '+alias : ''), fields || {});
	q.className = 'Streams_Invited';
	return q;
};

/**
 * Create raw query with BEGIN clause.
 * You'll have to specify shards yourself when calling execute().
 * @method BEGIN
 * @param {string} [$lockType] First parameter to pass to query.begin() function
 * @return {Db.Query.Mysql} The generated query
 */
Base.BEGIN = function($lockType) {
	var q = Base.db().rawQuery('').begin($lockType);
	q.className = 'Streams_Invited';
	return q;
};

/**
 * Create raw query with COMMIT clause
 * You'll have to specify shards yourself when calling execute().
 * @method COMMIT
 * @return {Db.Query.Mysql} The generated query
 */
Base.COMMIT = function() {
	var q = Base.db().rawQuery('').commit();
	q.className = 'Streams_Invited';
	return q;
};

/**
 * Create raw query with ROLLBACK clause
 * @method ROLLBACK
 * @param {Object} criteria can be used to target the query to some shards.
 *   Otherwise you'll have to specify shards yourself when calling execute().
 * @return {Db.Query.Mysql} The generated query
 */
Base.ROLLBACK = function(criteria) {
	var q = Base.db().rawQuery('').rollback(crieria);
	q.className = 'Streams_Invited';
	return q;
};

/**
 * The name of the class
 * @property className
 * @type string
 */
Base.prototype.className = "Streams_Invited";

// Instance methods

/**
 * Create INSERT query to the class table
 * @method INSERT
 * @param {object} [fields={}] The fields as an associative array of {column: value} pairs
 * @param {string} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.prototype.setUp = function() {
	// does nothing for now
};

/**
 * Create INSERT query to the class table
 * @method INSERT
 * @param {object} [fields={}] The fields as an associative array of {column: value} pairs
 * @param {string} [alias=null] Table alias
 * @return {Db.Query.Mysql} The generated query
 */
Base.prototype.db = function () {
	return Base.db();
};

/**
 * Retrieve the table name to use in SQL statements
 * @method table
 * @param {boolean} [withoutDbName=false] Indicates wheather table name should contain the database name
 * @return {String|Db.Expression} The table name as string optionally without database name if no table sharding was started
 * or Db.Expression object with prefix and database name templates is table was sharded
 */
Base.prototype.table = function () {
	return Base.table();
};

/**
 * Retrieves primary key fields names for class table
 * @method primaryKey
 * @return {string[]} An array of field names
 */
Base.prototype.primaryKey = function () {
	return [
		
	];
};

/**
 * Retrieves field names for class table
 * @method fieldNames
 * @return {array} An array of field names
 */
Base.prototype.fieldNames = function () {
	return Base.fieldNames();
};

/**
 * Retrieves field names for class table
 * @method fieldNames
 * @static
 * @return {array} An array of field names
 */
Base.fieldNames = function () {
	return [
		"userId",
		"token",
		"state",
		"insertedTime",
		"updatedTime",
		"expireTime"
	];
};

/**
 * Method is called before setting the field and verifies if value is string of length within acceptable limit.
 * Optionally accept numeric value which is converted to string
 * @method beforeSet_userId
 * @param {string} value
 * @return {string} The value
 * @throws {Error} An exception is thrown if 'value' is not string or is exceedingly long
 */
Base.prototype.beforeSet_userId = function (value) {
		if (value == null) {
			value='';
		}
		if (value instanceof Db.Expression) return value;
		if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Buffer))
			throw new Error('Must pass a String or Buffer to '+this.table()+".userId");
		if (typeof value === "string" && value.length > 31)
			throw new Error('Exceedingly long value being assigned to '+this.table()+".userId");
		return value;
};

	/**
	 * Returns the maximum string length that can be assigned to the userId field
	 * @return {integer}
	 */
Base.prototype.maxSize_userId = function () {

		return 31;
};

	/**
	 * Returns schema information for userId column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
Base.column_userId = function () {

return [["varbinary","31","",false],false,"MUL",null];
};

/**
 * Method is called before setting the field and verifies if value is string of length within acceptable limit.
 * Optionally accept numeric value which is converted to string
 * @method beforeSet_token
 * @param {string} value
 * @return {string} The value
 * @throws {Error} An exception is thrown if 'value' is not string or is exceedingly long
 */
Base.prototype.beforeSet_token = function (value) {
		if (value == null) {
			value='';
		}
		if (value instanceof Db.Expression) return value;
		if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Buffer))
			throw new Error('Must pass a String or Buffer to '+this.table()+".token");
		if (typeof value === "string" && value.length > 255)
			throw new Error('Exceedingly long value being assigned to '+this.table()+".token");
		return value;
};

	/**
	 * Returns the maximum string length that can be assigned to the token field
	 * @return {integer}
	 */
Base.prototype.maxSize_token = function () {

		return 255;
};

	/**
	 * Returns schema information for token column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
Base.column_token = function () {

return [["varbinary","255","",false],false,"",null];
};

/**
 * Method is called before setting the field and verifies if value belongs to enum values list
 * @method beforeSet_state
 * @param {string} value
 * @return {string} The value
 * @throws {Error} An exception is thrown if 'value' does not belong to enum values list
 */
Base.prototype.beforeSet_state = function (value) {
		if (value instanceof Db.Expression) return value;
		if (['pending','accepted','declined','arrived','forwarded','expired'].indexOf(value) < 0)
			throw new Error("Out-of-range value "+JSON.stringify(value)+" being assigned to "+this.table()+".state");
		return value;
};

	/**
	 * Returns schema information for state column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
Base.column_state = function () {

return [["enum","'pending','accepted','declined','arrived','forwarded','expired'","",false],false,"","pending"];
};

/**
 * Method is called before setting the field
 * @method beforeSet_insertedTime
 * @param {String} value
 * @return {Date|Db.Expression} If 'value' is not Db.Expression the current date is returned
 */
Base.prototype.beforeSet_insertedTime = function (value) {
		if (value instanceof Db.Expression) return value;
		if (typeof value !== 'object' && !isNaN(value)) {
			value = parseInt(value);
			value = new Date(value < 10000000000 ? value * 1000 : value);
		}
		value = (value instanceof Date) ? Base.db().toDateTime(value) : value;
		return value;
};

	/**
	 * Returns schema information for insertedTime column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
Base.column_insertedTime = function () {

return [["timestamp",null,null,null],false,"","CURRENT_TIMESTAMP"];
};

/**
 * Method is called before setting the field
 * @method beforeSet_updatedTime
 * @param {String} value
 * @return {Date|Db.Expression} If 'value' is not Db.Expression the current date is returned
 */
Base.prototype.beforeSet_updatedTime = function (value) {
		if (value == undefined) return value;
		if (value instanceof Db.Expression) return value;
		if (typeof value !== 'object' && !isNaN(value)) {
			value = parseInt(value);
			value = new Date(value < 10000000000 ? value * 1000 : value);
		}
		value = (value instanceof Date) ? Base.db().toDateTime(value) : value;
		return value;
};

	/**
	 * Returns schema information for updatedTime column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
Base.column_updatedTime = function () {

return [["timestamp",null,null,null],true,"",null];
};

/**
 * Method is called before setting the field
 * @method beforeSet_expireTime
 * @param {String} value
 * @return {Date|Db.Expression} If 'value' is not Db.Expression the current date is returned
 */
Base.prototype.beforeSet_expireTime = function (value) {
		if (value == undefined) return value;
		if (value instanceof Db.Expression) return value;
		if (typeof value !== 'object' && !isNaN(value)) {
			value = parseInt(value);
			value = new Date(value < 10000000000 ? value * 1000 : value);
		}
		value = (value instanceof Date) ? Base.db().toDateTime(value) : value;
		return value;
};

	/**
	 * Returns schema information for expireTime column
	 * @return {array} [[typeName, displayRange, modifiers, unsigned], isNull, key, default]
	 */
Base.column_expireTime = function () {

return [["timestamp",null,null,null],true,"",null];
};

/**
 * Check if mandatory fields are set and updates 'magic fields' with appropriate values
 * @method beforeSave
 * @param {Object} value The object of fields
 * @param {Function} callback Call this callback if you return null
 * @return {Object|null} Return the fields, modified if necessary. If you return null, then you should call the callback(err, modifiedFields)
 * @throws {Error} If e.g. mandatory field is not set or a bad values are supplied
 */
Base.prototype.beforeSave = function (value) {

	// convention: we'll have updatedTime = insertedTime if just created.
	this['updatedTime'] = value['updatedTime'] = new Db.Expression('CURRENT_TIMESTAMP');
	if (this.fields["userId"] == undefined && value["userId"] == undefined) {
		this.fields["userId"] = value["userId"] = "";
	}
	if (this.fields["token"] == undefined && value["token"] == undefined) {
		this.fields["token"] = value["token"] = "";
	}
	return value;
};

module.exports = Base;