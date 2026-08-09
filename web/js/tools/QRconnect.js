/**
 * Streams/QRconnect tool.
 *
 * Shows the user's signed invite QR code inline — not in a dialog — so it can
 * sit on a connect page and be held up to someone else's camera. Scanning it
 * takes them to this user's profile and offers them the invite.
 *
 * When they accept, this tool opens THEIR profile, so the introduction goes
 * both ways. Several people accepting means several profiles opening; that's
 * intended.
 *
 * @module Streams-tools
 * @class Streams QRconnect
 * @constructor
 * @param {Object} [options]
 *   @param {String} [options.publisherId] Defaults to the logged-in user
 *   @param {String} [options.url] A preloaded invite url (the PHP renderer
 *     supplies this); otherwise the tool fetches one
 *   @param {Integer} [options.expires] Unix time the url's signature expires
 *   @param {String} [options.appUrl] Where scanning should bring people
 *   @param {Integer} [options.size=250] Width and height in pixels
 *   @param {String} [options.correctLevel='H'] QR error correction level
 *   @param {Boolean} [options.listen=true] Watch for people connecting
 *   @param {Boolean} [options.invokeOnScanned=true] Open their profile
 *   @param {String} [options.visitsStreamName='Streams/user/visits']
 *   @param {Array} [options.connectedMessageTypes] Message types to react to.
 *     Defaults to the ones Streams_Stream::join posts by itself
 *   @param {String} [options.profileUrl] Pattern for a profile url
 *   @param {Integer} [options.refreshBefore=300] Seconds before the signature
 *     expires to quietly fetch a fresh url
 *   @param {Integer} [options.freshness=120] Ignore messages older than this
 *     many seconds, so a socket reconnect doesn't replay old connections
 *   @param {Integer} [options.dedupe=10000] Milliseconds to ignore repeat
 *     signals about the same person
 *   @param {Q.Event} [options.onRefresh]
 *   @param {Q.Event} [options.onScanned] Called with (userId, url). Return
 *     false to suppress opening their profile.
 */
(function (Q, $, window, undefined) {

var Users = Q.Users;
var Streams = Q.Streams;

Q.Tool.define("Streams/QRconnect", function (options) {
	var tool = this;
	var state = tool.state;

	tool.seen = {};

	// our own class on the element, so the stylesheet doesn't depend on how
	// Q.Tool normalizes the case of "Streams/QRconnect"
	$(tool.element).addClass('Streams_QRconnect');

	state.publisherId = state.publisherId || Users.loggedInUserId();

	if (!state.publisherId) {
		// there's no code to show until we know whose it is
		Users.login({
			onSuccess: {
				"Streams/QRconnect": function () {
					state.publisherId = Users.loggedInUserId();
					tool.refresh();
					if (state.listen) {
						tool.listen();
					}
				}
			}
		});
		return;
	}

	tool.refresh();

	if (state.listen) {
		tool.listen();
	}
},

{
	publisherId: null,
	appUrl: null,
	url: null,
	expires: null,
	size: 250,
	colorDark: "#000000",
	colorLight: "#ffffff",
	correctLevel: "H",
	listen: true,
	invokeOnScanned: true,
	visitsStreamName: "Streams/user/visits",
	connectedMessageTypes: ["Streams/joined", "Streams/visited"],
	profileUrl: "profile/{{userId}}",
	refreshBefore: 300,
	freshness: 120,
	dedupe: 10000,
	onRefresh: new Q.Event(),
	onScanned: new Q.Event()
},

{
	/**
	 * Draw the QR code, fetching a fresh url unless one was preloaded.
	 * @method refresh
	 * @param {Function} [callback]
	 * @param {Boolean} [force] Fetch a new url even if we already have one
	 */
	refresh: function (callback, force) {
		var tool = this;
		var state = tool.state;

		// the PHP renderer preloads a url, but only for the first paint —
		// after that it's stale and we go back to the server
		if (!force && state.url && !tool.rendered) {
			return tool._render(state.url, state.expires, callback);
		}

		$(tool.element).addClass('Q_working');
		Q.req('Streams/QRconnect', ['url'], function (err, response) {
			$(tool.element).removeClass('Q_working');
			var msg = Q.firstErrorMessage(err, response && response.errors);
			if (msg) {
				return console.warn("Streams/QRconnect: " + msg);
			}
			var slot = Q.getObject(['slots', 'url'], response) || {};
			if (!slot.url) {
				return console.warn("Streams/QRconnect: no url returned");
			}
			tool._render(slot.url, slot.expires, callback);
		}, {
			fields: {
				publisherId: state.publisherId,
				appUrl: state.appUrl
			}
		});
	},

	/**
	 * @method _render
	 * @private
	 * @param {String} url
	 * @param {Integer} expires
	 * @param {Function} [callback]
	 */
	_render: function (url, expires, callback) {
		var tool = this;
		var state = tool.state;

		state.url = url;
		state.expires = expires;

		Q.addScript("{{Q}}/js/qrcode/qrcode.js", function () {
			if (tool.removed) {
				return;
			}

			var $code = $('<div class="Streams_QRconnect_code" />');
			$(tool.element).empty().append($code);

			new QRCode($code[0], {
				text: url,
				width: state.size,
				height: state.size,
				colorDark: state.colorDark,
				colorLight: state.colorLight,
				correctLevel: (window.QRCode.CorrectLevel[state.correctLevel]
					|| window.QRCode.CorrectLevel.H)
			});

			tool.rendered = true;
			tool._scheduleRefresh(expires);

			Q.handle(callback, tool, [url]);
			Q.handle(state.onRefresh, tool, [url, expires]);
		});
	},

	/**
	 * The signature in the url expires. Swap in a fresh code before it does,
	 * so a screen left open overnight still scans in the morning.
	 * @method _scheduleRefresh
	 * @private
	 * @param {Integer} expires Unix time
	 */
	_scheduleRefresh: function (expires) {
		var tool = this;
		var state = tool.state;

		if (tool.timeout) {
			clearTimeout(tool.timeout);
			tool.timeout = null;
		}
		if (!expires) {
			return;
		}

		var ms = (expires - state.refreshBefore) * 1000 - Date.now();
		if (ms < 1000) {
			ms = 1000;
		}
		// setTimeout tops out near 24.8 days; invite windows are far shorter
		if (ms > 2147483647) {
			return;
		}

		tool.timeout = setTimeout(function () {
			tool.refresh(null, true);
		}, ms);
	},

	/**
	 * Watch for someone accepting the invite this code offers.
	 *
	 * The server joins them to this stream when they accept — not when they
	 * scan — so this fires on consent, which is the moment worth opening
	 * someone's profile on. It needs nothing from the scanner's device.
	 *
	 * We listen to the messages join already posts: Streams/joined the first
	 * time, Streams/visited if they ever rejoin. Only the connect recorder
	 * joins anyone to this stream, so those are unambiguous without a message
	 * type of our own.
	 * @method listen
	 */
	listen: function () {
		var tool = this;
		var state = tool.state;

		Streams.retainWith(tool).get(
			state.publisherId, state.visitsStreamName,
			function (err) {
				if (Q.firstErrorMessage(err)) {
					// created on the first connection, so it may not exist yet
					return;
				}
				var stream = tool.visitsStream = this;
				Q.each(state.connectedMessageTypes, function (i, type) {
					stream.onMessage(type).set(function (message) {
						if (!tool._isFresh(message)) {
							return;
						}
						tool.scanned(message.byUserId);
					}, tool);
				});
			}
		);
	},

	/**
	 * Whether a message just happened, as opposed to being replayed when a
	 * socket reconnects and flushes what we missed. Opening a stranger's
	 * profile because the wifi dropped an hour ago would be baffling.
	 * @method _isFresh
	 * @private
	 * @param {Object} message
	 * @return {Boolean}
	 */
	_isFresh: function (message) {
		var sent = message && message.sentTime;
		if (!sent) {
			return true;
		}
		var t = new Date(sent).getTime();
		if (isNaN(t)) {
			// some browsers won't parse the DB datetime format; don't
			// discard a real connection over it
			return true;
		}
		return (Math.abs(Date.now() - t) / 1000) < this.state.freshness;
	},

	/**
	 * Someone accepted the invite. Opens their profile unless a handler on
	 * state.onScanned returns false.
	 *
	 * Several people connecting means several calls, and several columns —
	 * that's intended. The dedupe below is per person, not global.
	 * @method scanned
	 * @param {String} userId
	 */
	scanned: function (userId) {
		var tool = this;
		var state = tool.state;

		if (!userId || userId === state.publisherId) {
			return;
		}
		if (tool.seen[userId]) {
			return;
		}
		tool.seen[userId] = setTimeout(function () {
			delete tool.seen[userId];
		}, state.dedupe);

		var url = Q.url(state.profileUrl.interpolate({ userId: userId }));

		if (false === Q.handle(state.onScanned, tool, [userId, url])) {
			return;
		}
		if (!state.invokeOnScanned) {
			return;
		}

		// Q.invoke in this codebase takes {title, content, className, trigger,
		// onActivate, columnIndex} — it builds a column around content you
		// supply, not around a url. Q.handle is how you navigate to one.
		// Communities/connect overrides onScanned with openUserProfile, which
		// is the right call there.
		Q.handle(url);
	},

	Q: {
		beforeRemove: function () {
			var tool = this;
			if (tool.timeout) {
				clearTimeout(tool.timeout);
				tool.timeout = null;
			}
			Q.each(tool.seen, function (userId, timeout) {
				clearTimeout(timeout);
			});
			tool.seen = {};
		}
	}
});

})(Q, Q.jQuery, window);
