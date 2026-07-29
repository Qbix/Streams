/**
 * Class representing subscription rows.
 *
 * @module Streams
 */
var Q = require('Q');
var Db = Q.require('Db');
var Users = Q.require('Users');
var Streams = Q.require('Streams');

/**
 * Class representing 'Subscription' rows in the 'Streams' database
 * <br/>{"type": [ array of message types ], "notifications": 5}
 * @namespace Streams
 * @class Subscription
 * @extends Base.Streams.Subscription
 * @constructor
 * @param fields {object} The fields values to initialize table row as
 * an associative array of `{column: value}` pairs
 */
function Streams_Subscription (fields) {

	// Run constructors of mixed in objects
	Streams_Subscription.constructors.apply(this, arguments);

	/*
	 * Add any other methods to the model class by assigning them to this.
	 
	 * * * */
}

Q.mixin(Streams_Subscription, Q.require('Base/Streams/Subscription'));

/**
 * Test message according to filters set up for the user and generate array of subscription rules
 * @method test
 * @static
 * @param {String} userId
 * @param {Q.Streams.Stream} stream
 * @param {Q.Streams.Messagel} message
 * @param {Function} callback First argument is any possible error, second is array of delivery methods
 */
/**
 * Test message according to filters set up for the user and generate array of subscription rules
 * @method test
 * @static
 * @param {String} userId
 * @param {Q.Streams.Stream} stream
 * @param {Q.Streams.Message} message
 * @param {Function} callback First argument is any possible error, second is array of delivery methods
 * @param {Streams_Participant} [participant] Pass the participant row if you already
 *   have it, to avoid re-querying it when the subscription has a "participant" filter.
 *   Ignored unless it matches userId, publisherId and streamName.
 */
/**
 * Test message according to filters set up for the user and generate array of subscription rules
 *
 * The filter can contain:
 *
 *   {
 *     "types": [ ...patterns matched against the message type... ],
 *     "instructions": { "<path>": "<pattern>" },   // applied to every type
 *     "participant":  { "<path>": "<pattern>" },   // applied to every type
 *     "messages": {
 *       "<messageType>": {
 *         "instructions": { ... },   // applies to this type only
 *         "participant":  { ... }    // applies to this type only
 *       }
 *     },
 *     "notifications": 0
 *   }
 *
 * A "messages" section REPLACES the corresponding top-level filter for that
 * message type rather than merging with it, so a type can opt out of a global
 * rule by setting the key to null. Top-level "instructions" and "participant"
 * apply to every message type that passed "types" — a message lacking one of
 * the named instruction paths is filtered out, so prefer the per-type form
 * unless the rule genuinely applies to everything.
 *
 * @method test
 * @static
 * @param {String} userId
 * @param {Q.Streams.Stream} stream
 * @param {Q.Streams.Message} message
 * @param {Streams_Participant} [participant] Pass the participant row if you already
 *   have it, to avoid re-querying it when the subscription has a "participant" filter.
 *   Ignored unless it matches userId, publisherId and streamName.
 * @param {Function} callback First argument is any possible error, second is array of delivery methods
 */
Streams_Subscription.test = function _Subscription_test(
	userId, stream, message, participant, callback
) {
	if (!callback) return;
	var msgType = message.getType();
	(new Streams.Subscription({
		ofUserId: userId,
		publisherId: stream.fields.publisherId,
		streamName: stream.fields.name
	})).retrieve(function(err, sub) {
		if (err) return callback(err);
		if (!sub.length) return callback(null, []); // no active subscriptions
		sub = sub[0];
		var time = (new Date()).getTime();
		if ((sub.fields.untilTime && sub.fields.untilTime < time
		|| (sub.fields.duration && sub.fields.insertedTime + sub.fields.duration * 1000 < time))) {
			return callback(null, []); // date passed
		}
		var filter;
		try {
			if (sub.fields.filter) {
				filter = JSON.parse(sub.fields.filter);
			}
			if (!filter) {
				// even if bad JSON, let's just do this as a fallback.
				filter = Streams.Stream.getConfigField(
					stream.fields.type, 
					['subscriptions', 'filter'],
					{ 
						types: [
							"^(?!(Users/)|(Streams/)).*/", 
							"Streams/relatedTo", 
							"Streams/announcement",
							"Streams/chat/message"
						],
						notifications: 0
					}
				);
			}
		} catch (err) {
			return callback(err);
		}
		var types = (filter && filter.types) || [];
		var matched = false;
		for (var i=0, l=types.length; i<l; ++i) {
			if (msgType.match(types[i])) {
				matched = true;
				break;
			}
		}

		// per-message-type overrides, if any
		var mf = Q.getObject(['messages', msgType], filter) || {};

		var instructions = ('instructions' in mf)
			? mf.instructions
			: (filter && filter.instructions);
		var allInstructions = message.getAllInstructions();
		var matchedInstructions = true;
		if (instructions) {
			for (var instruction in instructions) {
				var p = instructions[instruction];
				var v = Q.getObject(instruction, allInstructions);
				if (v === undefined || !String(v).match(p)) {
					matchedInstructions = false;
					break;
				}
			}
		}
		if (!matched || !matchedInstructions) {
			return callback(null, []); // not subscribed to this message type or instructions do not match
		}

		// only trust a passed-in participant row if it's actually for this
		// user and stream, otherwise treat it as if it wasn't passed at all
		var known = (participant
			&& participant.fields.userId === userId
			&& participant.fields.publisherId === stream.fields.publisherId
			&& participant.fields.streamName === stream.fields.name
		) ? participant : null;

		var fp = ('participant' in mf)
			? mf.participant
			: (filter && filter.participant);
		if (known) {
			return _testParticipant(known);
		}
		if (!fp) {
			return _proceed(); // nothing needs the row, so don't query for it
		}
		stream.getParticipant(userId, function (err, row) {
			if (err) return callback(err);
			if (!row) return callback(null, []); // no longer a participant
			_testParticipant(row);
		});

		function _testParticipant(participant) {
			if (participant.fields.state !== 'participating') {
				return callback(null, []);
			}
			if (!fp) {
				return _proceed();
			}
			var allExtras = participant.getAllExtras() || {};
			for (var extra in fp) {
				var v = Q.getObject(extra, allExtras);
				if (v === undefined || !_matchesExtra(v, fp[extra])) {
					return callback(null, []);
				}
			}
			_proceed();
		}

		function _matchesExtra(value, pattern) {
			if (Array.isArray(value)) {
				return value.some(function (item) {
					return String(item).match(pattern);
				});
			}
			return !!String(value).match(pattern);
		}

		function _proceed() {
			var notifications = filter.notifications;
			Streams.SubscriptionRule.SELECT('*').where({
				ofUserId: userId,
				publisherId: stream.fields.publisherId,
				streamName: stream.fields.name
			}).execute(function(err, rules) {
				if (err) return callback(err);
				if (!rules.length) return callback(null, []); // nothing to wait on
				var waitFor = rules.map(function(r){ return r.fields.ordinal; });
				var p = new Q.Pipe(waitFor, 1, function (params) {
					var deliveries = [], ordinal, param;
					for (ordinal in params) {
						param = params[ordinal];
						if (param[0]) {
							return callback(param[0]);
						}
						if (param[1]) {
							deliveries.push(param[1]);
						}
					}
					callback(null, deliveries);
				});
				p.run();
				rules.forEach(function (rule) {
					var o = rule.fields.ordinal;
					var readyTime = rule.fields.readyTime;
					var filter;
					try {
						filter = rule.fields.filter ? JSON.parse(rule.fields.filter) : {};
					} catch (e) {
						return p.fill(o)(e);
					}
					var types = filter.types;
					function _checkNotifications() {
						if (!notifications) {
							return _checkDelivery();
						}
						// get last disconnection time
						Streams.Message.SELECT('publisherId, streamName, type, sentTime')
						.where({
							publisherId: userId,
							streamName: 'Streams/participating',
							type: 'Streams/disconnected'
						}).orderBy('sentTime', false)
						.limit(1)
						.execute(function(err, res) {
							if (err) {
								return p.fill(o)(err);
							}
							// NOTE: all Streams/participating for a given stream must be on the same shard
							var timeOnline = res.length
								? res.reduce(function(pv, cv) {
									return pv > cv ? pv : cv;
								}, res[0].sentTime)
								: (readyTime ? readyTime : 0);
							// now check notifications since timeOnline
							Streams.Notification.SELECT('COUNT(1) as count').where({
								userId: userId,
								"insertedTime >": timeOnline,
								publisherId: stream.fields.publisherId,
								streamName: stream.fields.name,
								type: msgType
							}).execute(function (err, res) {
								if (err) return p.fill(o)(err);
								// to support counting in shards
								var count = res.reduce(function(pv, cv) { 
									return pv + Number(cv.count); 
								}, 0);
								if (count < notifications) {
									_checkDelivery();
								} else {
									p.fill(o)();
								}
							}, {plain: true});
						}, { plain: true });
					}
					function _checkDelivery() {
						var deliver;
						try {
							deliver = rule.fields.deliver ? JSON.parse(rule.fields.deliver) : null;
						} catch (e) {
							return p.fill(o)(e);
						}
						p.fill(o)(null, deliver);
					}
					var notFound = (
						types && Q.typeOf(types) === 'array'
						&& types.length && types.indexOf(msgType) < 0
					);
					if (notFound || (Date.fromTimestamp(readyTime) > new Date())) {
						// type and readyTime filters not passed
						return p.fill(o)();
					}					
					var labels = filter.labels;
					if (!labels || Q.typeOf(labels) !== "array" || !labels.length) {
						return _checkNotifications();
					}
					Users.Contact.SELECT('*').where({
						userId: userId,
						contactUserId: stream.fields.publisherId,
						label: labels
					}).execute(function (err, contacts) {
						if (err) {
							return p.fill(o)(err);
						}
						if (!contacts.length) {
							return p.fill(o)();
						}
						_checkNotifications();
					});
				});
			});
		}
	});

	/* * * */
}

/**
 * The setUp() method is called the first time
 * an object of this class is constructed.
 * @method setUp
 */
Streams_Subscription.prototype.setUp = function () {
	// put any code here
};

module.exports = Streams_Subscription;